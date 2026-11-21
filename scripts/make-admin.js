// Promote an existing account to admin.
// Admins can't sign up publicly, so create a normal account first and then run:
//   npm run make-admin -- someone@example.com
import { client, users } from "../db.js";

const email = process.argv[2]?.toLowerCase().trim();

if (!email) {
  console.log("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

try {
  await client.connect();
  const result = await users.updateOne(
    { email },
    { $set: { role: "admin", roleSelected: true, isBlocked: false, updatedAt: new Date() } }
  );
  if (!result.matchedCount) {
    console.log(`No user found with email ${email}. Sign up with this email first.`);
  } else {
    console.log(`${email} is now an admin`);
  }
} finally {
  await client.close();
}
