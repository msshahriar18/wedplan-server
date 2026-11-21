// Adds some demo services for an existing vendor account (already approved).
//   npm run seed -- vendor@example.com
import { client, services, users } from "../db.js";

const email = process.argv[2]?.toLowerCase().trim();
const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;

const demoServices = [
  {
    serviceName: "Full Day Wedding Photography & Cinematic Film",
    category: "Photography & Videography",
    description:
      "Two photographers covering getting ready to the last dance, a 5 minute cinematic highlight film, drone shots and an online gallery with 600+ edited photos delivered within 3 weeks.",
    price: 1800,
    location: "Dhaka",
    images: [img("photo-1519741497674-611481863552"), img("photo-1511285560929-80b456fea0bc")],
  },
  {
    serviceName: "Lakeside Garden Venue for 300 Guests",
    category: "Wedding Venues",
    description:
      "Open garden by the lake with a covered stage, bridal suite, parking for 80 cars and an indoor hall as rain backup. In-house generator and decoration-friendly space.",
    price: 4500,
    location: "Gazipur",
    images: [img("photo-1519167758481-83f550bb49b3"), img("photo-1464366400600-7168b8af9bc3")],
  },
  {
    serviceName: "Floral Stage & Entrance Decoration",
    category: "Decoration & Florist",
    description:
      "Fresh flower stage backdrop, entrance arch, table centerpieces and fairy light setup. Color theme planned with you after a short call.",
    price: 950,
    location: "Chattogram",
    images: [img("photo-1478146896981-b80fe463b330"), img("photo-1469371670807-013ccf25f16a")],
  },
  {
    serviceName: "Traditional Kacchi & Buffet Catering",
    category: "Catering Services",
    description:
      "Mutton kacchi, chicken roast, borhani, firni and a dessert corner. Price is per 100 guests, includes serving staff, plates and on-site live cooking.",
    price: 1200,
    location: "Dhaka",
    images: [img("photo-1555244162-803834f70033"), img("photo-1414235077428-338989a2e8c0")],
  },
  {
    serviceName: "Bridal Makeup & Hair Styling Package",
    category: "Makeup & Styling",
    description:
      "HD bridal makeup, hair styling, saree draping and jewellery setting. Includes one trial session and makeup for two family members on the wedding day.",
    price: 450,
    location: "Sylhet",
    images: [img("photo-1487412947147-5cebf100ffc2"), img("photo-1522335789203-aabd1fc54bc9")],
  },
  {
    serviceName: "Custom Bridal Lehenga & Groom Sherwani",
    category: "Wedding Fashion",
    description:
      "Made to measure lehenga and sherwani with hand embroidery. Three fittings, matching dupatta and safa included. Delivery in 4 to 6 weeks.",
    price: 1600,
    location: "Dhaka",
    images: [img("photo-1583939003579-730e3918a45a"), img("photo-1595407753234-0882f1e77954")],
  },
];

if (!email) {
  console.log("Usage: npm run seed -- <vendor email>");
  process.exit(1);
}

try {
  await client.connect();
  const vendor = await users.findOne({ email, role: "vendor" });
  if (!vendor) {
    console.log(`No vendor account found for ${email}`);
  } else {
    const now = Date.now();
    const docs = demoServices.map((service, i) => ({
      ...service,
      vendorId: vendor._id,
      status: "approved",
      isAvailable: true,
      createdAt: new Date(now - i * 60_000),
      updatedAt: new Date(now - i * 60_000),
    }));
    await services.insertMany(docs);
    console.log(`Added ${docs.length} services for ${email}`);
  }
} finally {
  await client.close();
}
