import "dotenv/config";
import {
  PrismaClient,
  ProductAvailability,
  UserRole,
  UserStatus,
  ProductStatus,
  VendorStatus,
  VendorType,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DIRECT_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL is not defined in your .env file.");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  console.log("🌱 Seeding PackAM database...");

  // ============================================================
  // CATEGORIES
  // ============================================================

  const foodDrinks = await prisma.category.upsert({
    where: {
      slug: "food-drinks",
    },
    update: {},
    create: {
      name: "Food & Drinks",
      slug: "food-drinks",
      description: "Meals, snacks and drinks around campus.",
    },
  });

  const academicMaterials = await prisma.category.upsert({
    where: {
      slug: "academic-materials",
    },
    update: {},
    create: {
      name: "Academic Materials",
      slug: "academic-materials",
      description: "School supplies and academic materials.",
    },
  });

  const printing = await prisma.category.upsert({
    where: {
      slug: "printing",
    },
    update: {},
    create: {
      name: "Printing",
      slug: "printing",
      description: "Printing and related academic services.",
    },
  });

  const everydayEssentials = await prisma.category.upsert({
    where: {
      slug: "everyday-essentials",
    },
    update: {},
    create: {
      name: "Everyday Essentials",
      slug: "everyday-essentials",
      description: "Useful everyday items around campus.",
    },
  });

  const phonesAccessories = await prisma.category.upsert({
    where: {
      slug: "phones-accessories",
    },
    update: {},
    create: {
      name: "Phones & Accessories",
      slug: "phones-accessories",
      description: "Selected phone and electronic accessories.",
    },
  });

  // ============================================================
  // VENDORS / SOURCES
  // ============================================================

  const campusMart = await prisma.vendor.upsert({
    where: {
      id: "seed-vendor-campus-mart",
    },
    update: {},
    create: {
      id: "seed-vendor-campus-mart",
      name: "Campus Mart",
      type: VendorType.SUPERMARKET,
      location: "OOU Campus",
      phone: "08000000001",
      status: VendorStatus.ACTIVE,
      notes: "Development seed vendor.",
    },
  });

  const foodCorner = await prisma.vendor.upsert({
    where: {
      id: "seed-vendor-food-corner",
    },
    update: {},
    create: {
      id: "seed-vendor-food-corner",
      name: "Campus Food Corner",
      type: VendorType.RESTAURANT,
      location: "OOU Campus",
      phone: "08000000002",
      status: VendorStatus.ACTIVE,
      notes: "Development seed vendor.",
    },
  });

  const academicHub = await prisma.vendor.upsert({
    where: {
      id: "seed-vendor-academic-hub",
    },
    update: {},
    create: {
      id: "seed-vendor-academic-hub",
      name: "Academic Hub",
      type: VendorType.SHOP,
      location: "OOU Campus",
      phone: "08000000003",
      status: VendorStatus.ACTIVE,
      notes: "Development seed vendor.",
    },
  });

  const printSpot = await prisma.vendor.upsert({
    where: {
      id: "seed-vendor-print-spot",
    },
    update: {},
    create: {
      id: "seed-vendor-print-spot",
      name: "Campus Print Spot",
      type: VendorType.PRINTING,
      location: "OOU Campus",
      phone: "08000000004",
      status: VendorStatus.ACTIVE,
      notes: "Development seed vendor.",
    },
  });

  const gadgetShop = await prisma.vendor.upsert({
    where: {
      id: "seed-vendor-gadget-shop",
    },
    update: {},
    create: {
      id: "seed-vendor-gadget-shop",
      name: "Campus Gadget Shop",
      type: VendorType.SHOP,
      location: "OOU Campus",
      phone: "08000000005",
      status: VendorStatus.ACTIVE,
      notes: "Development seed vendor.",
    },
  });

  // ============================================================
  // PRODUCTS
  // ============================================================

  const products = [
    {
      id: "seed-product-indomie",
      name: "Indomie Noodles",
      slug: "indomie-noodles",
      description: "Instant noodles.",
      customerPrice: 700,
      categoryId: foodDrinks.id,
      vendor: campusMart,
      sourcePrice: 650,
    },
    {
      id: "seed-product-water",
      name: "Bottled Water",
      slug: "bottled-water",
      description: "Chilled bottled water.",
      customerPrice: 300,
      categoryId: foodDrinks.id,
      vendor: campusMart,
      sourcePrice: 250,
    },
    {
      id: "seed-product-soft-drink",
      name: "Soft Drink",
      slug: "soft-drink",
      description: "Cold soft drink.",
      customerPrice: 500,
      categoryId: foodDrinks.id,
      vendor: foodCorner,
      sourcePrice: 450,
    },
    {
      id: "seed-product-meal",
      name: "Campus Rice Meal",
      slug: "campus-rice-meal",
      description: "A regular rice meal from a campus food vendor.",
      customerPrice: 1800,
      categoryId: foodDrinks.id,
      vendor: foodCorner,
      sourcePrice: 1650,
    },
    {
      id: "seed-product-pen",
      name: "Blue Ballpoint Pen",
      slug: "blue-ballpoint-pen",
      description: "Blue ink ballpoint pen.",
      customerPrice: 200,
      categoryId: academicMaterials.id,
      vendor: academicHub,
      sourcePrice: 150,
    },
    {
      id: "seed-product-exercise-book",
      name: "Exercise Book",
      slug: "exercise-book",
      description: "Standard student exercise book.",
      customerPrice: 700,
      categoryId: academicMaterials.id,
      vendor: academicHub,
      sourcePrice: 600,
    },
    {
      id: "seed-product-a4-paper",
      name: "A4 Paper",
      slug: "a4-paper",
      description: "A4 paper for assignments and projects.",
      customerPrice: 1000,
      categoryId: academicMaterials.id,
      vendor: academicHub,
      sourcePrice: 900,
    },
    {
      id: "seed-product-file",
      name: "Project File",
      slug: "project-file",
      description: "File for school projects and documents.",
      customerPrice: 800,
      categoryId: academicMaterials.id,
      vendor: academicHub,
      sourcePrice: 700,
    },
    {
      id: "seed-product-printing",
      name: "Black & White Printing",
      slug: "black-white-printing",
      description: "Black and white document printing.",
      customerPrice: 100,
      categoryId: printing.id,
      vendor: printSpot,
      sourcePrice: 70,
    },
    {
      id: "seed-product-colour-printing",
      name: "Colour Printing",
      slug: "colour-printing",
      description: "Colour document printing.",
      customerPrice: 300,
      categoryId: printing.id,
      vendor: printSpot,
      sourcePrice: 250,
    },
    {
      id: "seed-product-tissue",
      name: "Tissue Paper",
      slug: "tissue-paper",
      description: "Everyday tissue paper.",
      customerPrice: 800,
      categoryId: everydayEssentials.id,
      vendor: campusMart,
      sourcePrice: 700,
    },
    {
      id: "seed-product-toothpaste",
      name: "Toothpaste",
      slug: "toothpaste",
      description: "Everyday toothpaste.",
      customerPrice: 1500,
      categoryId: everydayEssentials.id,
      vendor: campusMart,
      sourcePrice: 1350,
    },
    {
      id: "seed-product-usb-cable",
      name: "USB Charging Cable",
      slug: "usb-charging-cable",
      description: "USB charging cable.",
      customerPrice: 2500,
      categoryId: phonesAccessories.id,
      vendor: gadgetShop,
      sourcePrice: 2200,
    },
    {
      id: "seed-product-earphones",
      name: "Wired Earphones",
      slug: "wired-earphones",
      description: "Basic wired earphones.",
      customerPrice: 3000,
      categoryId: phonesAccessories.id,
      vendor: gadgetShop,
      sourcePrice: 2700,
    },
    {
      id: "seed-product-phone-charger",
      name: "Phone Charger",
      slug: "phone-charger",
      description: "Basic phone charging adapter.",
      customerPrice: 4500,
      categoryId: phonesAccessories.id,
      vendor: gadgetShop,
      sourcePrice: 4000,
    },
  ];

  for (const item of products) {
    const product = await prisma.product.upsert({
      where: {
        slug: item.slug,
      },
      update: {
        name: item.name,
        description: item.description,
        customerPrice: item.customerPrice,
        categoryId: item.categoryId,
        status: ProductStatus.ACTIVE,
      },
      create: {
        id: item.id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        customerPrice: item.customerPrice,
        categoryId: item.categoryId,
        status: ProductStatus.ACTIVE,
      },
    });

    const source = await prisma.productSource.upsert({
      where: {
        productId_vendorId: {
          productId: product.id,
          vendorId: item.vendor.id,
        },
      },
      update: {
        currentPrice: item.sourcePrice,
        availability: ProductAvailability.AVAILABLE,
      },
      create: {
        productId: product.id,
        vendorId: item.vendor.id,
        currentPrice: item.sourcePrice,
        availability: ProductAvailability.AVAILABLE,
      },
    });

    await prisma.priceRecord.create({
      data: {
        productSourceId: source.id,
        price: item.sourcePrice,
      },
    });

    await prisma.availabilityRecord.create({
      data: {
        productSourceId: source.id,
        availability: ProductAvailability.AVAILABLE,
      },
    });
  }

  // ============================================================
  // TEST STUDENT
  // ============================================================

  const student = await prisma.user.upsert({
    where: {
      email: "student@packam.test",
    },
    update: {},
    create: {
      email: "student@packam.test",
      phone: "08000000101",
      firstName: "PackAM",
      lastName: "Student",
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      studentProfile: {
        create: {
          matricNumber: "PACKAM/TEST/001",
          department: "Computer Science",
          faculty: "Science",
          level: "300",
        },
      },
    },
  });

  // ============================================================
  // TEST RUNNER
  // ============================================================

  await prisma.user.upsert({
    where: {
      email: "runner@packam.test",
    },
    update: {},
    create: {
      email: "runner@packam.test",
      phone: "08000000102",
      firstName: "PackAM",
      lastName: "Runner",
      role: UserRole.RUNNER,
      status: UserStatus.ACTIVE,
      runnerProfile: {
        create: {
          isAvailable: true,
          isVerified: true,
        },
      },
    },
  });

  // ============================================================
  // TEST ADMIN
  // ============================================================

  await prisma.user.upsert({
    where: {
      email: "admin@packam.test",
    },
    update: {},
    create: {
      email: "admin@packam.test",
      phone: "08000000103",
      firstName: "PackAM",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      adminProfile: {
        create: {},
      },
    },
  });

  // ============================================================
  // STUDENT CART
  // ============================================================

  await prisma.cart.upsert({
    where: {
      userId: student.id,
    },
    update: {},
    create: {
      userId: student.id,
    },
  });

  console.log("✅ PackAM seed completed successfully.");
  console.log("");
  console.log("Test accounts:");
  console.log("Student: student@packam.test");
  console.log("Runner:  runner@packam.test");
  console.log("Admin:   admin@packam.test");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });