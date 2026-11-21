# WedPlan — Wedding Planning Platform (Server)

REST API for WedPlan, a wedding marketplace for couples, vendors and admins. Built with Express 5 and the native MongoDB driver. Authentication is handled by Better Auth on the client app; this server verifies JWTs and enforces every role and ownership rule on its own.

- **Live site:** https://your-live-site-link.vercel.app
- **Client repo:** https://github.com/your-username/wedplan-client
- **Server repo:** https://github.com/your-username/wedplan-server

## Features

- JWT verification middleware (rejects missing, invalid and expired tokens with 401)
- Role middlewares for admin, vendor and customer (403 on wrong role)
- User, role and blocked status are always read from the database, not from the token or request body
- Ownership checks on every update and delete
- Server side validation for services, bookings and profile updates
- Free plan limit: 3 active services, unlimited on Premium
- Booking rules: no booking own service, no duplicate active request for the same service and date, only pending requests can be accepted, rejected or cancelled
- Stripe Checkout (subscription mode). Premium is activated only from verified webhook events, never from the success redirect
- Handles renewals, failed payments and cancellation; when Premium ends the vendor goes back to 3 active services
- Search across name, description, category, location and vendor name, plus category, location and price filters, price sorting and pagination
- Central error handler and 404 handler

## Tech Stack

Node.js · Express 5 · MongoDB · Stripe · jose · dotenv · cors

## Collections

| Collection | Notes |
| --- | --- |
| `user`, `session`, `account` | Managed by Better Auth. `user` also has `role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt` |
| `services` | `vendorId`, `serviceName`, `category`, `description`, `price`, `location`, `images`, `status`, `isAvailable`, `createdAt` |
| `bookings` | `serviceId`, `vendorId`, `customerId`, `eventDate`, `eventLocation`, `message`, `status`, `createdAt` |
| `transactions` | `vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt` |

## API

| Method | Route | Access |
| --- | --- | --- |
| GET | `/services` | Public (approved + available only) |
| GET | `/services/featured`, `/services/categories`, `/services/:id` | Public |
| GET | `/vendor/services`, `/vendor/services/:id` | Vendor |
| POST | `/services` | Vendor |
| PATCH | `/services/:id`, `/services/:id/availability` | Vendor (owner) |
| DELETE | `/services/:id` | Vendor (owner) |
| POST | `/bookings` | Customer |
| GET | `/bookings/my` | Customer |
| PATCH | `/bookings/:id/cancel` | Customer (owner) |
| GET | `/vendor/bookings` | Vendor |
| PATCH | `/vendor/bookings/:id` | Vendor (owner) |
| GET / PATCH | `/users/me` | Any signed in user |
| PATCH | `/users/me/role` | Google users choosing a role once |
| GET | `/stats/customer`, `/stats/vendor`, `/stats/admin` | Matching role |
| GET | `/admin/users`, `/admin/users/:id` | Admin |
| PATCH | `/admin/users/:id/block` | Admin |
| GET | `/admin/services` | Admin |
| PATCH | `/admin/services/:id/status` | Admin |
| DELETE | `/admin/services/:id` | Admin |
| GET | `/admin/transactions` | Admin (read only) |
| POST | `/payments/create-checkout-session` | Vendor |
| GET | `/payments/session/:sessionId`, `/payments/my` | Vendor |
| POST | `/payments/cancel-subscription` | Vendor |
| POST | `/webhook` | Stripe (signature verified) |

## Run Locally

1. Install

   ```bash
   git clone https://github.com/your-username/wedplan-server.git
   cd wedplan-server
   npm install
   ```

2. Create `.env` from the example

   ```bash
   cp .env.example .env
   ```

   | Variable | What it is |
   | --- | --- |
   | `MONGODB_URI` / `DB_NAME` | MongoDB Atlas connection string and database name |
   | `JWT_SECRET` | Same value as `JWT_SECRET` in the client |
   | `CLIENT_URL` | Client URL(s) for CORS and Stripe redirects, comma separated |
   | `STRIPE_SECRET_KEY` | Stripe test secret key |
   | `STRIPE_PREMIUM_PRICE_ID` | Price id of a recurring monthly product in Stripe |
   | `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint |

3. Run

   ```bash
   npm run dev
   ```

4. Forward Stripe webhooks while testing locally

   ```bash
   stripe listen --forward-to localhost:5000/webhook
   ```

   Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.

   Events used: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Admin Account

Admins can't sign up from the website. Create a normal account first, then promote it:

```bash
npm run make-admin -- admin@example.com
```

## Demo Data

Sign up one or two vendor accounts, then add six approved demo services:

```bash
npm run seed -- vendor1@example.com vendor2@example.com
```

## Deploy (Vercel)

`vercel.json` is included. Add the same environment variables in the Vercel project, then create a Stripe webhook endpoint pointing to `https://your-server-domain/webhook` with the events above and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
