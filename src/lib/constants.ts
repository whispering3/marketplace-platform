export interface MarketCategory {
  id: string;
  label: string;
  icon: string;
  subcategories: string[];
}

export const MARKET_CATEGORIES: MarketCategory[] = [
  {
    id: "books",
    label: "Books & Media",
    icon: "📚",
    subcategories: ["Books", "Zines", "Courses", "Audio", "Video", "Other"]
  },
  {
    id: "software",
    label: "Software & Digital Goods",
    icon: "💾",
    subcategories: ["Licensed Software", "Templates", "Themes", "Plugins", "Design Assets", "Other"]
  },
  {
    id: "hardware",
    label: "Electronics & Hardware",
    icon: "🔌",
    subcategories: ["Computers", "Components", "Accessories", "Repair Parts", "Networking", "Other"]
  },
  {
    id: "collectibles",
    label: "Collectibles",
    icon: "🧾",
    subcategories: ["Art", "Cards", "Coins", "Memorabilia", "Vintage", "Other"]
  },
  {
    id: "apparel",
    label: "Apparel",
    icon: "👕",
    subcategories: ["Clothing", "Footwear", "Accessories", "Independent Brands", "Other"]
  },
  {
    id: "jewelry",
    label: "Jewelry & Watches",
    icon: "💎",
    subcategories: ["Jewelry", "Watches", "Handmade", "Precious Metals", "Other"]
  },
  {
    id: "home",
    label: "Home & Workshop",
    icon: "🧰",
    subcategories: ["Tools", "Decor", "Kitchen", "Office", "Workshop", "Other"]
  },
  {
    id: "shipping",
    label: "Shipping Supplies",
    icon: "📦",
    subcategories: ["Packaging", "Labels", "Protective Supplies", "Mailers", "Other"]
  },
  {
    id: "services",
    label: "Professional Services",
    icon: "🧑‍💼",
    subcategories: ["Design", "Writing", "Consulting", "Development", "Operations", "Other"]
  },
  {
    id: "security",
    label: "Privacy & Security",
    icon: "🔐",
    subcategories: ["Audits", "Training", "Encrypted Storage", "Account Safety", "Other"]
  },
  {
    id: "business",
    label: "Business Supplies",
    icon: "🏢",
    subcategories: ["Operations", "Stationery", "Equipment", "Compliance", "Other"]
  },
  {
    id: "other",
    label: "Other Listings",
    icon: "❓",
    subcategories: ["General Goods", "Wholesale", "Custom Orders", "Other"]
  }
];

export const ALL_SUBCATEGORIES = MARKET_CATEGORIES.flatMap(c => c.subcategories);
