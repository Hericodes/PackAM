export const siteConfig = {
  name: "PackAM",

  description:
    "Need something but can't leave where you are? Order it. We'll get it to you.",

  url: "http://localhost:3000",

  brand: {
    colors: {
      yellow: "#FEB80A",
      red: "#F04438",
      black: "#080808",
      cream: "#FFFDF7",
      white: "#FFFFFF",
    },
  },

  navigation: {
    student: [
      {
        label: "Home",
        href: "/",
      },
      {
        label: "Search",
        href: "/search",
      },
      {
        label: "Cart",
        href: "/cart",
      },
    ],
  },

  categories: [
    {
      name: "Food & Drinks",
      slug: "food-drinks",
    },
    {
      name: "Academic Materials",
      slug: "academic-materials",
    },
    {
      name: "Printing",
      slug: "printing",
    },
    {
      name: "Everyday Essentials",
      slug: "everyday-essentials",
    },
    {
      name: "Phones & Accessories",
      slug: "phones-accessories",
    },
  ],

  messaging: {
    headline: "Need something? We PackAM.",

    description:
      "Whatever you need around campus, we'll help you get it without you having to leave where you are.",

    shortDescription:
      "Food, academic materials, everyday essentials and more — ordered from campus and delivered to wherever you are.",

    requestProduct: "Can't find it? Request a Product.",

    humour: {
      emptyCart: "Your cart is looking lonely 😭",
      noSearchResults:
        "Hmm... we couldn't find that one. Try another search or request it.",
      findingRunner:
        "We're still looking for someone brave enough to run this mission 🫡",
      runnerAssigned: "Someone has accepted the mission 🫡",
      sourcing: "We don dey find your stuff 😂",
      almostThere: "Almost there 👀",
      delivered: "Your package don land. 🎒",
    },
  },
} as const;

