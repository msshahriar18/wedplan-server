import { Router } from "express";
import { transactions, users } from "../db.js";
import { verifyToken, verifyVendor } from "../middlewares/auth.js";
import { ApiError, asyncHandler } from "../middlewares/error.js";
import { getPeriodEnd, stripe } from "../lib/stripe.js";

const router = Router();

const clientUrl = () => (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();

router.post(
  "/payments/create-checkout-session",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    if (req.user.subscriptionPlan === "premium") {
      throw new ApiError(400, "You are already on the Premium plan");
    }

    // vendor id always comes from the verified token, never from the request body
    const vendorId = req.user.id;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
      customer_email: req.user.email,
      client_reference_id: vendorId,
      metadata: { vendorId, plan: "premium" },
      subscription_data: { metadata: { vendorId, plan: "premium" } },
      success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl()}/payment/cancel`,
    });

    res.send({ url: session.url });
  })
);

// success page asks this to show the result, it never activates anything itself
router.get(
  "/payments/session/:sessionId",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      throw new ApiError(400, "Invalid checkout session");
    }

    const transaction = await transactions.findOne({ stripeSessionId: sessionId });
    if (transaction) {
      if (!transaction.vendorId.equals(req.user._id)) throw new ApiError(403, "Forbidden");
      return res.send({
        status: transaction.status,
        plan: transaction.plan,
        amount: transaction.amount,
        currency: transaction.currency,
        createdAt: transaction.createdAt,
        subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
      });
    }

    // webhook hasn't arrived yet, just make sure the session belongs to this vendor
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      throw new ApiError(404, "Checkout session not found");
    }
    if (session.metadata?.vendorId !== req.user.id) throw new ApiError(403, "Forbidden");

    res.send({ status: session.status === "expired" ? "expired" : "processing" });
  })
);

router.get(
  "/payments/my",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const result = await transactions
      .find({ vendorId: req.user._id })
      .project({ stripeSubscriptionId: 0 })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({
      plan: req.user.subscriptionPlan,
      subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
      cancelAtPeriodEnd: Boolean(req.user.subscriptionCancelAtPeriodEnd),
      transactions: result,
    });
  })
);

// cancels at the end of the paid period, webhook downgrades the vendor after that
router.post(
  "/payments/cancel-subscription",
  verifyToken,
  verifyVendor,
  asyncHandler(async (req, res) => {
    const subscriptionId = req.user.stripeSubscriptionId;
    if (req.user.subscriptionPlan !== "premium" || !subscriptionId) {
      throw new ApiError(400, "You don't have an active Premium subscription");
    }

    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    await users.updateOne(
      { _id: req.user._id },
      {
        $set: {
          subscriptionCancelAtPeriodEnd: true,
          subscriptionExpiresAt: getPeriodEnd(subscription) || req.user.subscriptionExpiresAt,
        },
      }
    );
    res.send({ cancelAtPeriodEnd: true });
  })
);

export default router;
