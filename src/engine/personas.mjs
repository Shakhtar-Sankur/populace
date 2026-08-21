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
  // Rates are per-kilometre in the local currency, scaled the way the first
  // five are: roughly what a courier is paid, not an exchange-rate conversion.
  hcmc: { name: "Ho Chi Minh City", lat: 10.8231, lng: 106.6297, currency: "VND", rate: 5000 },
  dhaka: { name: "Dhaka", lat: 23.8103, lng: 90.4125, currency: "BDT", rate: 22 },
  karachi: { name: "Karachi", lat: 24.8607, lng: 67.0011, currency: "PKR", rate: 55 },
  kualalumpur: { name: "Kuala Lumpur", lat: 3.139, lng: 101.6869, currency: "MYR", rate: 2 },
  bengaluru: { name: "Bengaluru", lat: 12.9716, lng: 77.5946, currency: "INR", rate: 10 },
  lahore: { name: "Lahore", lat: 31.5204, lng: 74.3587, currency: "PKR", rate: 55 },
  chennai: { name: "Chennai", lat: 13.0827, lng: 80.2707, currency: "INR", rate: 10 },
  hyderabad: { name: "Hyderabad", lat: 17.385, lng: 78.4867, currency: "INR", rate: 10 },
  kolkata: { name: "Kolkata", lat: 22.5726, lng: 88.3639, currency: "INR", rate: 10 },
  hanoi: { name: "Hanoi", lat: 21.0278, lng: 105.8342, currency: "VND", rate: 5000 },
  surabaya: { name: "Surabaya", lat: -7.2575, lng: 112.7521, currency: "IDR", rate: 3000 },
  cebu: { name: "Cebu", lat: 10.3157, lng: 123.8854, currency: "PHP", rate: 10 },
  colombo: { name: "Colombo", lat: 6.9271, lng: 79.8612, currency: "LKR", rate: 90 },
  kathmandu: { name: "Kathmandu", lat: 27.7172, lng: 85.324, currency: "NPR", rate: 35 },
  phnompenh: { name: "Phnom Penh", lat: 11.5564, lng: 104.9282, currency: "KHR", rate: 800 },
  ahmedabad: { name: "Ahmedabad", lat: 23.0225, lng: 72.5714, currency: "INR", rate: 10 },
  pune: { name: "Pune", lat: 18.5204, lng: 73.8567, currency: "INR", rate: 10 },
  jaipur: { name: "Jaipur", lat: 26.9124, lng: 75.7873, currency: "INR", rate: 10 },
  islamabad: { name: "Islamabad", lat: 33.6844, lng: 73.0479, currency: "PKR", rate: 55 },
  chittagong: { name: "Chittagong", lat: 22.3569, lng: 91.7832, currency: "BDT", rate: 22 },
  danang: { name: "Da Nang", lat: 16.0544, lng: 108.2022, currency: "VND", rate: 5000 },
  bandung: { name: "Bandung", lat: -6.9175, lng: 107.6191, currency: "IDR", rate: 3000 },
  davao: { name: "Davao", lat: 7.1907, lng: 125.4553, currency: "PHP", rate: 10 },
  chiangmai: { name: "Chiang Mai", lat: 18.7883, lng: 98.9853, currency: "THB", rate: 6 },
  yangon: { name: "Yangon", lat: 16.8409, lng: 96.1735, currency: "MMK", rate: 900 },
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
  hcmc: [
    "Kẹt xe dữ lắm ở Điện Biên Phủ, đi đường khác đi",
    "Đang có thưởng khu Quận 1, chạy đi anh em",
    "Cẩn thận ngập nước ở Thảo Điền nha",
    "Ai đang ở Phú Nhuận không? Đơn nhiều lắm",
    "Nghỉ chút đã, chạy 7 tiếng rồi",
  ],
  dhaka: [
    "গুলশানে অনেক জ্যাম, বিকল্প রাস্তা নিন",
    "মতিঝিলে এখন সার্জ চলছে",
    "ধানমন্ডিতে পানি জমেছে, সাবধানে",
    "বনানীতে কেউ আছেন? অনেক অর্ডার আসছে",
    "একটু বিশ্রাম নিচ্ছি, ৮ ঘণ্টা হয়ে গেল",
  ],
  karachi: [
    "شاہراہِ فیصل پر بہت رش ہے، دوسرا راستہ لیں",
    "کلفٹن میں ابھی سرج چل رہا ہے",
    "ڈیفنس میں پانی کھڑا ہے، احتیاط کریں",
    "کوئی گلشن اقبال میں ہے؟ آرڈر بہت آ رہے ہیں",
    "تھوڑا آرام کر لوں، سات گھنٹے ہو گئے",
  ],
  kualalumpur: [
    "Jam teruk kat Jalan Tun Razak, ambil jalan lain",
    "Ada surge kat KLCC sekarang",
    "Hati-hati banjir kilat kat Bangsar",
    "Sesiapa kat Cheras? Banyak order masuk",
    "Rehat kejap, dah 7 jam bawa motor",
  ],
  bengaluru: [
    "Silk Board nalli traffic jaasti ide, bere route togolli",
    "Koramangala kade surge idhe eega",
    "Outer Ring Road nalli neeru nintide, hushar",
    "Yaaru Whitefield nalli iddira? Orders tumba bartaide",
    "Swalpa rest, belagininda 90 km aagide",
  ],
  lahore: [
    "فیروزپور روڈ پر بہت ٹریفک ہے، دوسرا راستہ لیں",
    "گلبرگ میں ابھی سرج لگا ہوا ہے",
    "ڈی ایچ اے میں پانی کھڑا ہے، دھیان سے",
    "کوئی جوہر ٹاؤن میں ہے؟ آرڈر بہت ہیں",
    "چائے کا وقفہ، صبح سے ستر کلومیٹر ہو گئے",
  ],
  chennai: [
    "Anna Salai la romba traffic, vera route la ponga",
    "T Nagar pakkam ippo surge irukku",
    "Velachery la thanni thengi irukku, jaakirathai",
    "Yaaru OMR la irukkeenga? Orders niraya varuthu",
    "Konjam rest, kaalaila irunthu 80 km aachu",
  ],
  hyderabad: [
    "Hitech City daggara traffic ekkuva undi, vere route veldam",
    "Banjara Hills lo ippudu surge nadustondi",
    "Kukatpally lo neellu nilichayi, jagratha",
    "Evaraina Gachibowli lo unnara? Orders baaga vastunnayi",
    "Konchem rest, udayam nunchi 85 km ayindi",
  ],
  kolkata: [
    "ই এম বাইপাসে প্রচুর জ্যাম, অন্য রাস্তা ধরুন",
    "পার্ক স্ট্রিটে এখন সার্জ চলছে",
    "সল্টলেকে জল জমেছে, সাবধানে চালান",
    "কেউ কি হাওড়ায় আছেন? অর্ডার প্রচুর আসছে",
    "একটু চা খেয়ে নিই, সকাল থেকে ৭৫ কিলোমিটার",
  ],
  hanoi: [
    "Tắc đường kinh khủng ở Trường Chinh, đi lối khác nhé",
    "Đang có thưởng khu Hoàn Kiếm, tranh thủ đi",
    "Cẩn thận ngập ở Thái Hà nhé anh em",
    "Ai đang ở Cầu Giấy không? Đơn về nhiều lắm",
    "Nghỉ tí đã, chạy từ sáng được 80 cây rồi",
  ],
  surabaya: [
    "Macet parah di Ahmad Yani, lewat jalan lain aja",
    "Lagi surge di Tunjungan, lumayan nih",
    "Hati-hati genangan di Rungkut",
    "Ada yang di Gubeng? Orderan rame banget",
    "Istirahat dulu, udah 8 jam narik",
  ],
  cebu: [
    "Grabe ang traffic sa Colon, lain dalan na lang",
    "Naay surge karon sa IT Park, sulit",
    "Bantay sa baha sa Mandaue, hinay-hinay",
    "Kinsa naa sa Lahug? Daghan kaayo booking",
    "Pahulay sa, 7 oras na ko nagdrive",
  ],
  colombo: [
    "ගාලු පාරේ විශාල රථවාහන තදබදයක්, වෙන පාරකින් යන්න",
    "දැන් කොල්ලුපිටියේ සර්ජ් එකක් තියෙනවා",
    "දෙහිවලේ වතුර පිරිලා, පරිස්සමෙන්",
    "නුගේගොඩ ඉන්නේ කවුද? ඕඩර් ගොඩක් එනවා",
    "පොඩි විවේකයක්, උදේ ඉඳන් කිලෝමීටර් 70යි",
  ],
  kathmandu: [
    "कोटेश्वरमा धेरै जाम छ, अर्को बाटो जानुहोस्",
    "अहिले ठमेलमा सर्ज चलिरहेको छ",
    "बल्खुमा पानी जमेको छ, ध्यान दिनुहोस्",
    "कोही ललितपुरमा हुनुहुन्छ? अर्डर धेरै आइरहेको छ",
    "अलिकति आराम, बिहानदेखि ६० किलोमिटर भयो",
  ],
  phnompenh: [
    "ស្ទះចរាចរណ៍ខ្លាំងនៅមហាវិថីមុនីវង្ស សូមប្រើផ្លូវផ្សេង",
    "ឥឡូវមានតម្លៃឡើងនៅបឹងកេងកង",
    "ប្រយ័ត្នទឹកជន់នៅទួលគោក",
    "អ្នកណានៅចំការមនទេ? ការកម្ម៉ង់ច្រើនណាស់",
    "សម្រាកបន្តិច បើកបានប្រាំពីរម៉ោងហើយ",
  ],
  ahmedabad: [
    "એસ જી હાઈવે પર બહુ ટ્રાફિક છે, બીજો રસ્તો લો",
    "અત્યારે સી જી રોડ પર સર્જ ચાલે છે",
    "મણિનગરમાં પાણી ભરાયું છે, સાચવીને",
    "કોઈ વસ્ત્રાપુરમાં છે? ઓર્ડર બહુ આવે છે",
    "થોડો આરામ, સવારથી ૭૫ કિલોમીટર થયા",
  ],
  pune: [
    "हिंजवडीला खूप ट्रॅफिक आहे, दुसऱ्या रस्त्याने जा",
    "कोरेगाव पार्कला आत्ता सर्ज चालू आहे",
    "कात्रजला पाणी साचलंय, जपून चला",
    "कोणी विमाननगरला आहे का? ऑर्डर खूप येतायत",
    "जरा आराम, सकाळपासून ८० किलोमीटर झाले",
  ],
  jaipur: [
    "टोंक रोड पर बहुत जाम है, दूसरा रास्ता लो",
    "एम आई रोड पर अभी सर्ज चल रहा है",
    "मानसरोवर में पानी भर गया, संभल के",
    "कोई वैशाली नगर में है? ऑर्डर बहुत आ रहे",
    "थोड़ा आराम, सुबह से ७० किलोमीटर हो गए",
  ],
  islamabad: [
    "سری نگر ہائی وے پر رش ہے، دوسرا راستہ لیں",
    "بلیو ایریا میں ابھی سرج ہے",
    "جی الیون میں پانی کھڑا ہے، احتیاط",
    "کوئی ایف سیون میں ہے؟ آرڈر بہت ہیں",
    "تھوڑا آرام، صبح سے پینسٹھ کلومیٹر",
  ],
  chittagong: [
    "আগ্রাবাদে অনেক জ্যাম, অন্য রাস্তা ধরুন",
    "জিইসি মোড়ে এখন সার্জ চলছে",
    "চকবাজারে পানি জমেছে, সাবধানে",
    "কেউ কি খুলশীতে আছেন? অর্ডার অনেক",
    "একটু বিশ্রাম, সকাল থেকে ৭০ কিলোমিটার",
  ],
  danang: [
    "Kẹt xe ở cầu Rồng, đi đường khác nhé",
    "Đang có thưởng khu Hải Châu",
    "Cẩn thận ngập ở Thanh Khê nha",
    "Ai đang ở Sơn Trà không? Đơn nhiều lắm",
    "Nghỉ chút, chạy từ sáng được 65 cây",
  ],
  bandung: [
    "Macet di Pasteur, lewat jalan lain aja",
    "Lagi surge di Dago, lumayan",
    "Hati-hati genangan di Kiaracondong",
    "Ada yang di Buah Batu? Orderan rame",
    "Istirahat dulu, udah 7 jam narik",
  ],
  davao: [
    "Grabe ang traffic sa Quimpo, lain dalan na lang",
    "Naay surge karon sa Lanang",
    "Bantay sa baha sa Matina, hinay lang",
    "Kinsa naa sa Buhangin? Daghan booking",
    "Pahulay sa, 7 oras na ko nagdrive",
  ],
  chiangmai: [
    "รถติดแถวช้างเผือก ใช้ทางอื่นดีกว่า",
    "ตอนนี้ราคาขึ้นแถวนิมมาน",
    "ระวังน้ำท่วมแถวสันทราย",
    "ใครอยู่แถวสันกำแพงบ้าง งานเยอะ",
    "พักก่อน วิ่งมา 6 ชั่วโมงแล้ว",
  ],
  yangon: [
    "ပြည်လမ်းမှာ ကားပိတ်နေတယ်၊ တခြားလမ်းသွားပါ",
    "အခု ဗိုလ်ချုပ်လမ်းမှာ ဈေးတက်နေတယ်",
    "လှိုင်မှာ ရေဝပ်နေတယ်၊ သတိထားပါ",
    "ကမာရွတ်မှာ ဘယ်သူရှိလဲ။ အော်ဒါတွေများတယ်",
    "ခဏနားလိုက်ဦးမယ်၊ မနက်ကတည်းက ၆၀ ကီလို",
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
  hcmc: ["Nguyen Van Hung", "Tran Thi Mai", "Le Minh Tuan", "Pham Thu Ha", "Vo Quoc Bao"],
  dhaka: ["Rafiqul Islam", "Nasrin Akter", "Shahin Alam", "Taslima Begum", "Jamal Uddin"],
  karachi: ["Asif Mehmood", "Ayesha Khan", "Bilal Ahmed", "Farah Siddiqui", "Usman Raza"],
  kualalumpur: ["Ahmad Faizal", "Nurul Aina", "Tan Wei Ming", "Siti Zubaidah", "Ravi Kumar"],
  bengaluru: ["Manjunath Rao", "Deepa Shetty", "Kiran Gowda", "Lakshmi Prasad", "Suresh Babu"],
  lahore: ["Tariq Javed", "Sadia Malik", "Imran Butt", "Rabia Nawaz", "Zeeshan Iqbal"],
  chennai: ["Murugan Selvam", "Kavitha Raman", "Arun Prakash", "Divya Krishnan", "Senthil Kumar"],
  hyderabad: ["Venkatesh Reddy", "Swathi Rao", "Naveen Chandra", "Padma Latha", "Srinivas Goud"],
  kolkata: ["Subhas Ghosh", "Ananya Das", "Bikash Mondal", "Rituparna Sen", "Debasish Roy"],
  hanoi: ["Do Van Long", "Bui Thi Lan", "Hoang Minh Duc", "Ngo Thu Trang", "Dang Quoc Anh"],
  surabaya: ["Slamet Wibowo", "Rina Kusuma", "Bambang Setiawan", "Endah Puspita", "Joko Susilo"],
  cebu: ["Junjun Abella", "Rosalie Yap", "Boyet Villar", "Marites Go", "Dodong Lim"],
  colombo: ["Nuwan Perera", "Chamari Silva", "Kasun Fernando", "Dilani Jayasuriya", "Sampath Ranasinghe"],
  kathmandu: ["Bikash Thapa", "Sunita Shrestha", "Ramesh Adhikari", "Anjali Gurung", "Prakash Tamang"],
  phnompenh: ["Sokha Chan", "Sreymom Kim", "Vuthy Sok", "Bopha Meas", "Dara Heng"],
  ahmedabad: ["Jignesh Patel", "Hetal Shah", "Kalpesh Desai", "Bhavna Mehta", "Nilesh Trivedi"],
  pune: ["Sachin Deshmukh", "Snehal Joshi", "Amol Kulkarni", "Manasi Pawar", "Nitin Jadhav"],
  jaipur: ["Mahendra Meena", "Sunita Choudhary", "Dinesh Saini", "Rekha Sharma", "Vijay Rathore"],
  islamabad: ["Kamran Abbasi", "Hina Shah", "Waqar Khattak", "Sana Gul", "Adnan Qureshi"],
  chittagong: ["Mizanur Rahman", "Shirin Sultana", "Anwar Hossain", "Rumana Khatun", "Faisal Chowdhury"],
  danang: ["Truong Van Nam", "Le Thi Hoa", "Phan Minh Khoa", "Nguyen Thuy Linh", "Huynh Tan Phat"],
  bandung: ["Asep Suryadi", "Nining Herlina", "Dadang Hermawan", "Euis Rohaeti", "Yusuf Maulana"],
  davao: ["Nonoy Bautista", "Cherry Lou Diaz", "Toto Mendoza", "Baby Jane Ong", "Jomar Alcantara"],
  chiangmai: ["Anucha Pongsri", "Wilai Boonmee", "Somsak Inta", "Praewa Chaiyo", "Thanet Kaewta"],
  yangon: ["Aung Ko Min", "Thida Win", "Zaw Lin Htet", "Nilar Aye", "Kyaw Soe Moe"],
};

const PLATFORMS = {
  manila: ["grab", "angkas", "joyride", "foodpanda", "lalamove"],
  mumbai: ["uber", "ola", "swiggy", "zomato", "rapido"],
  delhi: ["uber", "ola", "blinkit", "zepto", "amazon"],
  jakarta: ["gojek", "grab", "shopeefood", "maxim", "indrive"],
  bangkok: ["grab", "foodpanda", "lalamove", "shopeefood", "bolt"],
  hcmc: ["grab", "be", "gojek", "shopeefood", "ahamove"],
  dhaka: ["pathao", "uber", "foodpanda", "shohoz", "chaldal"],
  karachi: ["careem", "bykea", "indrive", "foodpanda", "yango"],
  kualalumpur: ["grab", "foodpanda", "lalamove", "shopeefood", "maxim"],
  bengaluru: ["uber", "ola", "swiggy", "zomato", "rapido"],
  lahore: ["careem", "bykea", "indrive", "foodpanda", "yango"],
  chennai: ["uber", "ola", "swiggy", "zomato", "rapido"],
  hyderabad: ["uber", "ola", "swiggy", "zomato", "rapido"],
  kolkata: ["uber", "ola", "swiggy", "zomato", "rapido"],
  hanoi: ["grab", "be", "gojek", "shopeefood", "ahamove"],
  surabaya: ["gojek", "grab", "shopeefood", "maxim", "indrive"],
  cebu: ["grab", "angkas", "joyride", "foodpanda", "lalamove"],
  colombo: ["pickme", "uber", "ubereats", "kangaroo", "darazfood"],
  kathmandu: ["pathao", "indrive", "foodmandu", "tootle", "bhojdeals"],
  phnompenh: ["grab", "passapp", "nham24", "foodpanda", "wownow"],
  ahmedabad: ["uber", "ola", "swiggy", "zomato", "rapido"],
  pune: ["uber", "ola", "swiggy", "zomato", "rapido"],
  jaipur: ["uber", "ola", "swiggy", "zomato", "rapido"],
  islamabad: ["careem", "bykea", "indrive", "foodpanda", "yango"],
  chittagong: ["pathao", "uber", "foodpanda", "shohoz", "chaldal"],
  danang: ["grab", "be", "gojek", "shopeefood", "ahamove"],
  bandung: ["gojek", "grab", "shopeefood", "maxim", "indrive"],
  davao: ["grab", "angkas", "joyride", "foodpanda", "lalamove"],
  chiangmai: ["grab", "foodpanda", "lalamove", "shopeefood", "bolt"],
  yangon: ["grab", "oway", "foodpanda", "yangonD2D", "hlaw"],
};

const pick = (arr, i) => arr[i % arr.length];

/**
 * Build `count` personas spread across the given cities.
 *
 * `engagement` multiplies how often someone posts, chats and likes. 1 is the
 * default population; 5 is a crowd that barely stops typing. It is deliberately
 * NOT applied to breakiness — making people take five times as many breaks
 * would quieten the run, which is the opposite of what the dial is for.
 *
 * Weights are probabilities per tick, so they are clamped below 1. The clamp
 * sits at 0.95 rather than 1 so that even at extreme multipliers the population
 * keeps a little variance instead of collapsing into every agent doing every
 * action on every tick — identical bots find identical bugs.
 */
export function buildPersonas(count, cityKeys = Object.keys(CITIES), engagement = 1) {
  const keys = cityKeys.filter((c) => CITIES[c]);
  if (!keys.length) throw new Error(`Unknown cities. Available: ${Object.keys(CITIES).join(", ")}`);
  const e = Number.isFinite(engagement) && engagement > 0 ? engagement : 1;
  const scale = (w) => Math.min(0.95, w * e);

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
      postiness: scale(0.05 + (i % 5) * 0.05), // 0.05 – 0.25 chance per tick
      chattiness: scale(0.05 + (i % 4) * 0.06),
      likeliness: scale(0.15 + (i % 3) * 0.2),
      breakiness: 0.03 + (i % 6) * 0.02, // not scaled - see the note above

      speedKmh: 18 + (i % 5) * 6, // 18–42 km/h city driving
    });
  }
  return personas;
}

export const chatterFor = (cityKey, n) => pick(CHATTER[cityKey] ?? CHATTER.manila, n);
export const replyLine = (n) => pick(REPLIES, n);
