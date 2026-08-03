// Who the simulated people are.
//
// A persona is a city, a platform, a rate, and behaviour weights that decide
// how often someone posts, chats, likes and takes breaks. The weights are the
// whole trick: a quiet courier who never posts sitting next to a rider who
// comments on everything is what makes a population read as people instead of
// a loop. Identical bots find identical bugs.
//
// This is the built-in "mobile workers" pack. Supply your own via
// `personas` in populace.config.mjs if your users are something else.

export const CITIES = {
  manila: { name: "Manila", lat: 14.5995, lng: 120.9842, currency: "PHP", rate: 10 },
  mumbai: { name: "Mumbai", lat: 19.076, lng: 72.8777, currency: "INR", rate: 10 },
  delhi: { name: "Delhi", lat: 28.6139, lng: 77.209, currency: "INR", rate: 10 },
  jakarta: { name: "Jakarta", lat: -6.2088, lng: 106.8456, currency: "IDR", rate: 3000 },
  bangkok: { name: "Bangkok", lat: 13.7563, lng: 100.5018, currency: "THB", rate: 6 },
};

// Chatter is per-city so a feed reads like the right place.
const CHATTER = {
  manila: [
    "Heavy traffic sa EDSA southbound, mag-alternate route kayo",
    "Surge ngayon sa BGC, sulit ang pila",
    "Ingat sa Commonwealth, may flood sa gilid",
    "Sino nandito sa Ortigas? Ang dami booking",
    "Break muna, 6 hours na akong byahe",
  ],
  mumbai: [
    "Andheri me bahut traffic hai, Link Road se jao",
    "Bandra side surge chal raha hai abhi",
    "Sion flyover pe jam, 25 min lag rahe hain",
    "Koi Powai me hai? Bookings kaafi aa rahe hain",
    "Chai break, subah se 80 km ho gaye",
  ],
  delhi: [
    "Ring Road pe heavy jam, Outer se nikal jao",
    "Connaught Place me surge hai abhi",
    "Gurgaon toll pe lambi line lagi hai",
    "Metro strike ki wajah se bookings badh gaye",
    "Paani pi lo bhai, aaj bahut garmi hai",
  ],
  jakarta: [
    "Macet parah di Sudirman, lewat jalan tikus aja",
    "Lagi surge di Kuningan, lumayan",
    "Hati-hati banjir di Kemang",
    "Ada yang di Senayan? Orderan rame",
    "Istirahat dulu, udah 7 jam narik",
  ],
  bangkok: [
    "รถติดมากแถวสุขุมวิท ใช้ทางด่วนดีกว่า",
    "ตอนนี้ราคาขึ้นแถวสีลม",
    "ระวังน้ำท่วมแถวลาดพร้าว",
    "ใครอยู่แถวอโศกบ้าง งานเยอะมาก",
    "พักก่อน วิ่งมา 6 ชั่วโมงแล้ว",
  ],
};

const REPLIES = [
  "Thanks for the heads up 🙏",
  "Same here, confirmed",
  "Good to know, avoiding that route",
  "How long is the wait?",
  "Salamat / Thanks bhai",
  "On my way there now",
];

const NAMES = {
  manila: ["Jhun Ramirez", "Maricel Santos", "Dante Cruz", "Liza Bautista", "Noel Aquino"],
  mumbai: ["Ramesh Kadam", "Priya Sharma", "Imran Shaikh", "Sunita Patil", "Arjun Nair"],
  delhi: ["Vikas Yadav", "Neha Gupta", "Rahul Verma", "Pooja Singh", "Manoj Kumar"],
  jakarta: ["Budi Santoso", "Siti Rahayu", "Agus Wijaya", "Dewi Lestari", "Eko Prasetyo"],
  bangkok: ["Somchai Prasert", "Ratana Wong", "Niran Suk", "Malee Chai", "Kittipong S."],
};

const PLATFORMS = {
  manila: ["grab", "angkas", "joyride", "foodpanda", "lalamove"],
  mumbai: ["uber", "ola", "swiggy", "zomato", "rapido"],
  delhi: ["uber", "ola", "blinkit", "zepto", "amazon"],
  jakarta: ["gojek", "grab", "shopeefood", "maxim", "indrive"],
  bangkok: ["grab", "foodpanda", "lalamove", "shopeefood", "bolt"],
};

const pick = (arr, i) => arr[i % arr.length];

/** Build `count` personas spread across the given cities. */
export function buildPersonas(count, cityKeys = Object.keys(CITIES)) {
  const keys = cityKeys.filter((c) => CITIES[c]);
  if (!keys.length) throw new Error(`Unknown cities. Available: ${Object.keys(CITIES).join(", ")}`);

  const personas = [];
  for (let i = 0; i < count; i++) {
    const cityKey = keys[i % keys.length];
    const city = CITIES[cityKey];
    const n = Math.floor(i / keys.length);
    personas.push({
      id: `sim${String(i + 1).padStart(3, "0")}`,
      cityKey,
      city,
      name: pick(NAMES[cityKey], n),
      platform: pick(PLATFORMS[cityKey], n),
      rate: city.rate,
      // Behaviour weights — the reason the population feels human.
      postiness: 0.05 + (i % 5) * 0.05, // 0.05 – 0.25 chance per tick
      chattiness: 0.05 + (i % 4) * 0.06,
      likeliness: 0.15 + (i % 3) * 0.2,
      breakiness: 0.03 + (i % 6) * 0.02,
      speedKmh: 18 + (i % 5) * 6, // 18–42 km/h city driving
    });
  }
  return personas;
}

export const chatterFor = (cityKey, n) => pick(CHATTER[cityKey] ?? CHATTER.manila, n);
export const replyLine = (n) => pick(REPLIES, n);
