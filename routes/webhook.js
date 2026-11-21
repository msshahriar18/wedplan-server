import express, { Router } from "express";
import { ObjectId } from "mongodb";
import { services, transactions, users } from "../db.js";
import { getInvoiceSubscriptionId, getPeriodEnd, stripe } from "../lib/stripe.js";
import { FREE_SERVICE_LIMIT } from "./services.js";

const router = Router();

const toVendorId = (value) => (value && ObjectId.isValid(value) ? new ObjectId(value) : null);

const activatePremium = async (vendorId, subscription) => {
  await users.updateOne(
    { _id: vendorId, role: "vendor" },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: getPeriodEnd(subscription),
        stripeSubscriptionId: subscription.id,
        subscriptionCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        updatedAt: new Date(),
      },
    }
  );
};

// back on free plan: keep the newest 3 active services, pause the rest
const downgradeToFree = async (vendorId) => {
  await users.updateOne(
    { _id: vendorId },
    {
      $set: {
        subscriptionPlan: "free",
        subscriptionExpiresAt: null,
        subscriptionCancelAtPeriodEnd: false,
        updatedAt: new Date(),
      },
      $unset: { stripeSubscriptionId: "" },
    }
  );

  const active = await services
    .find({ vendorId, isAvailable: true, status: { $ne: "rejected" } })
    .sort({ createdAt: -1 })
    .project({ _id: 1 })
    .toArray();
  const extra = active.slice(FREE_SERVICE_LIMIT).map((s) => s._id);
  if (extra.length) {
    await services.updateMany({ _id: { $in: extra } }, { $set: { isAvailable: false, updatedAt: new Date() } });
  }
};

const handleCheckoutCompleted = async (session) => {
  if (session.mode !== "subscription" || session.payment_status !== "paid") return;

  const vendorId = toVendorId(session.metadata?.vendorId || session.client_reference_id);
  if (!vendorId) return;

  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  // upsert keeps this idempotent when stripe retries the same event
  await transactions.updateOne(
    { stripeSessionId: session.id },
    {
      $setOnInsert: {
        vendorId,
        plan: "premium",
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || "usd",
        stripeSessionId: session.id,
        stripeSubscriptionId: subscription.id,
        stripeInvoiceId: typeof session.invoice === "string" ? session.invoice : session.invoice?.id,
        status: "paid",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  await activatePremium(vendorId, subscription);
};

const handleInvoice = async (invoice, status) => {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  // the first invoice is already saved from checkout.session.completed
  if (status === "paid" && invoice.billing_reason === "subscription_create") return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const vendorId = toVendorId(subscription.metadata?.vendorId);
  if (!vendorId) return;

  await transactions.updateOne(
    { stripeInvoiceId: invoice.id },
    {
      $set: { status },
      $setOnInsert: {
        vendorId,
        plan: "premium",
        amount: (status === "paid" ? invoice.amount_paid : invoice.amount_due) / 100,
        currency: invoice.currency || "usd",
        stripeSubscriptionId: subscriptionId,
        stripeInvoiceId: invoice.id,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  if (status === "paid") await activatePremium(vendorId, subscription);
};

const handleSubscriptionUpdated = async (subscription) => {
  const vendorId = toVendorId(subscription.metadata?.vendorId);
  if (!vendorId) return;

  if (["active", "trialing"].includes(subscription.status)) {
    await users.updateOne(
      { _id: vendorId, stripeSubscriptionId: subscription.id },
      {
        $set: {
          subscriptionExpiresAt: getPeriodEnd(subscription),
          subscriptionCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        },
      }
    );
  } else if (["canceled", "unpaid", "incomplete_expired"].includes(subscription.status)) {
    await downgradeToFree(vendorId);
  }
};

const handleSubscriptionDeleted = async (subscription) => {
  const vendorId = toVendorId(subscription.metadata?.vendorId);
  if (!vendorId) return;
  await downgradeToFree(vendorId);
  await transactions.updateMany(
    { stripeSubscriptionId: subscription.id, status: "paid" },
    { $set: { subscriptionEndedAt: new Date() } }
  );
};

// stripe needs the raw body to verify the signature, so this runs before express.json()
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "invoice.paid":
        await handleInvoice(event.data.object, "paid");
        break;
      case "invoice.payment_failed":
        await handleInvoice(event.data.object, "failed");
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        break;
    }
    res.send({ received: true });
  } catch (err) {
    console.error(`Webhook ${event.type} failed:`, err);
    // 500 makes stripe retry later
    res.status(500).send({ message: "Webhook handler failed" });
  }
});

export default router;
