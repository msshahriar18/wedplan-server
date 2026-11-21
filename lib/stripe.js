import Stripe from "stripe";
import "dotenv/config";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// newer stripe api versions moved the period end onto subscription items
export const getPeriodEnd = (subscription) => {
  const seconds =
    subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
};

export const getInvoiceSubscriptionId = (invoice) =>
  invoice.subscription ||
  invoice.parent?.subscription_details?.subscription ||
  invoice.lines?.data?.[0]?.subscription ||
  null;
