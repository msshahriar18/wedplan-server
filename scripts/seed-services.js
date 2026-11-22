// Adds demo services (already approved) for existing vendor accounts.
// Services are shared between the given vendors, and a free vendor
// only gets 3 of them active, same as the real rule.
// With 4 vendors each one gets 3 related services (photography, venues,
// catering, fashion studios).
//   npm run seed -- vendor1@example.com vendor2@example.com vendor3@example.com vendor4@example.com
import { client, services, users } from "../db.js";

const emails = process.argv.slice(2).map((e) => e.toLowerCase().trim());
const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;

// listed in round robin order: with 4 vendors each one gets 3 related services
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
    serviceName: "Traditional Kacchi & Buffet Catering",
    category: "Catering Services",
    description:
      "Mutton kacchi, chicken roast, borhani, firni and a dessert corner. Price is per 100 guests, includes serving staff, plates and on-site live cooking.",
    price: 1200,
    location: "Dhaka",
    images: [img("photo-1555244162-803834f70033"), img("photo-1414235077428-338989a2e8c0")],
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
  {
    serviceName: "Pre-Wedding & Engagement Photo Shoot",
    category: "Photography & Videography",
    description:
      "Half day outdoor shoot at a location of your choice with two outfit changes, 80 edited photos and a 60 second teaser reel for social media.",
    price: 550,
    location: "Cox's Bazar",
    images: [
      img("photo-1537633552985-df8429e8048b"),
      img("photo-1544078751-58fee2d8a03b"),
      img("photo-1532712938310-34cb3982ef74"),
    ],
  },
  {
    serviceName: "Rooftop Banquet Hall with City View",
    category: "Wedding Venues",
    description:
      "Air conditioned banquet hall for up to 450 guests with an open rooftop for the reception, separate dining area, lift access and parking in the basement.",
    price: 3200,
    location: "Dhaka",
    images: [img("photo-1519225421980-715cb0215aed"), img("photo-1523438885200-e635ba2c371e")],
  },
  {
    serviceName: "BBQ Night & Continental Buffet",
    category: "Catering Services",
    description:
      "Live grill station, pasta corner, salad bar and three desserts for reception nights. Price is per 100 guests with chefs, waiters and crockery included.",
    price: 1450,
    location: "Chattogram",
    images: [img("photo-1505935428862-770b6f24f629"), img("photo-1414235077428-338989a2e8c0")],
  },
  {
    serviceName: "Designer Wedding Gown & Veil Rental",
    category: "Wedding Fashion",
    description:
      "Choose from 40+ imported gowns with veil, alteration to your size and a free trial fitting. Rental covers three days around the wedding.",
    price: 380,
    location: "Dhaka",
    images: [
      img("photo-1594552072238-b8a33785b261"),
      img("photo-1550005809-91ad75fb315f"),
      img("photo-1606800052052-a08af7148866"),
    ],
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
    serviceName: "Floral Stage & Entrance Decoration",
    category: "Decoration & Florist",
    description:
      "Fresh flower stage backdrop, entrance arch, table centerpieces and fairy light setup. Color theme planned with you after a short call.",
    price: 950,
    location: "Gazipur",
    images: [img("photo-1478146896981-b80fe463b330"), img("photo-1469371670807-013ccf25f16a")],
  },
  {
    serviceName: "Gaye Holud Stage & Marigold Decoration",
    category: "Decoration & Florist",
    description:
      "Bright holud stage with marigold strings, floor seating, kula and dala set, lanterns and a photo corner. Setup and cleanup done by our team.",
    price: 700,
    location: "Chattogram",
    images: [img("photo-1519378058457-4c29a0a2efac"), img("photo-1507504031003-b417219a0fde")],
  },
  {
    serviceName: "Holud & Reception Party Makeup",
    category: "Makeup & Styling",
    description:
      "Two looks for holud and reception, hair styling, lashes and on-site touch ups for 4 hours. Extra family makeup can be added on request.",
    price: 320,
    location: "Dhaka",
    images: [
      img("photo-1617627143750-d86bc21e42bb"),
      img("photo-1596704017254-9b121068fb31"),
      img("photo-1515688594390-b649af70d282"),
    ],
  },
];

if (emails.length === 0) {
  console.log("Usage: npm run seed -- <vendor email> [more vendor emails]");
  process.exit(1);
}

try {
  await client.connect();
  const vendors = await users.find({ email: { $in: emails }, role: "vendor" }).toArray();
  if (vendors.length === 0) {
    console.log("No vendor accounts found for the given emails");
  } else {
    const now = Date.now();
    const activeCount = {};
    const docs = demoServices.map((service, i) => {
      const vendor = vendors[i % vendors.length];
      const key = vendor._id.toString();
      activeCount[key] = (activeCount[key] || 0) + 1;
      const canBeActive = vendor.subscriptionPlan === "premium" || activeCount[key] <= 3;
      return {
        ...service,
        vendorId: vendor._id,
        status: "approved",
        isAvailable: canBeActive,
        createdAt: new Date(now - i * 60_000),
        updatedAt: new Date(now - i * 60_000),
      };
    });
    await services.insertMany(docs);
    console.log(`Added ${docs.length} services for ${vendors.map((v) => v.email).join(", ")}`);
  }
} finally {
  await client.close();
}
