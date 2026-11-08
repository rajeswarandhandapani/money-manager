// One-time move of saved data from the first category list to the current one.

import { DEFAULT_CATEGORIES } from './classify.js';

export const TAXONOMY = 3;

const VT = 'Vacation & Travel';
const GL = 'Government & Legal';
const ADULT = ['Clothing', 'Adult Clothing & Shoes'];
const KIDS = ['Clothing', 'Kids Clothing & Shoes'];
const OFFICE = ['Household', 'Office & Postage'];
const SERVICE = ['Car', 'Service & Repairs'];
const LICENSES = [GL, 'Licenses & IDs'];
const INDIA = ['Savings', 'India Remittance'];

const MOVES = {
  HousingUtilities: {
    Electricity: ['Housing', 'Electricity'], Gas: ['Housing', 'Gas'], WaterSewer: ['Housing', 'Water & Sewer'],
    Internet: ['Housing', 'Internet'], Telephone: ['Housing', 'Phone'], HomeRent: ['Housing', 'Rent'],
    SecurityDeposit: ['Housing', 'Rent'], Print: OFFICE, Postage: OFFICE,
  },
  HomeOfficeTech: {
    Electronics: ['Household', 'Electronics'], Furniture: ['Household', 'Furniture'],
    OfficeSupplies: OFFICE, 'PhoneCase/Photos': ['Household', 'Electronics'],
  },
  Food: {
    'Groceries(Meat,Fish,Produce)': ['Food', 'Groceries'], 'Snacks/IceCream': ['Food', 'Snacks & Ice Cream'],
    Beverages: ['Food', 'Groceries'], TempleFood: ['Food', 'Temple Food'],
  },
  Automobile: {
    LoanEMI: SERVICE, Fuel: ['Transport', 'Fuel'], 'Service/Maintenance': SERVICE, CarWash: SERVICE,
    Registration: ['Car', 'Registration'], 'Tolls/Parking': ['Transport', 'Parking & Tolls'],
    TrafficTickets: LICENSES, AutoInsurance: ['Car', 'Auto Insurance'],
  },
  Travel: {
    Flights: [VT, 'Flights'], Hotels: [VT, 'Hotels'], RentalCars: [VT, 'Rental Cars'], Bus: ['Transport', 'Bus'],
  },
  Vacation: {
    VacationFood: [VT, 'Food'], Souvenirs: [VT, 'Souvenirs'], "Souvenirs(IncludesParents'USVacation)": [VT, 'Souvenirs'],
    Hotels: [VT, 'Hotels'], 'Tolls/Parking': [VT, 'Parking & Tolls'], Camping: [VT, 'Camping'], 'Attraction Fee': [VT, 'Attractions'],
  },
  Health: {
    HSAContributions: ['Health', 'HSA Contribution'], MedicalConsultations: ['Health', 'Doctor & Dental'],
  },
  Wellness: {
    'Gym/Fitness': ['Wellness', 'Gym'], Nutrition: ['Food', 'Groceries'], Moisturizer: ['Household', 'Toiletries & Skincare'],
  },
  PersonalCare: {
    AdultClothing: ADULT, Shoes: ADULT, 'Jewelry/Watches': ADULT, Laundry: ['Household', 'Supplies'],
    'Salon/Haircuts': ['Personal Care', 'Haircuts'], 'Salon/Haircuts(GreatClips)': ['Personal Care', 'Haircuts'],
  },
  Family: {
    Consumables: ['Household', 'Supplies'], 'Garden/IndoorPlants': ['Household', 'Home & Garden'],
    Storage: ['Household', 'Furniture'], 'Toiletries(Shampoo,BodyWash)': ['Household', 'Toiletries & Skincare'],
  },
  Children: {
    'Schooling/Tuition': ['Children', 'School'], 'Academy/Classes(Dance,Swim)': ['Children', 'Classes'],
    SportsGear: ['Children', 'Sports Gear'], BirthdayCelebrations: ['Children', 'Birthday Parties'], Clothing: KIDS, KidsShoes: KIDS,
  },
  Entertainment: {
    'Streaming(Netflix/etc.)': ['Entertainment', 'Streaming'], ComputerGames: ['Entertainment', 'Games'],
    GameCenters: ['Entertainment', 'Play Centers'], 'LocalOutings(Circus,FarmPicking)': ['Entertainment', 'Local Outings'],
  },
  Gifts: {
    Birthdays: ['Gifts & Giving', 'Birthdays'],
    GeneralGifting: ['Gifts & Giving', 'Gifts'],
  },
  WorkEducation: {
    Certifications: ['Work & Education', 'Certifications'], OnlineCourses: ['Work & Education', 'Courses & Books'],
    Textbooks: ['Work & Education', 'Courses & Books'], WebsiteDNS: ['Work & Education', 'Website'],
    ResumeServices: ['Work & Education', 'Resume'], SoftwareLicenses: ['Work & Education', 'Software'], TaxFiling: [GL, 'Tax Filing'],
  },
  IdentityLegal: {
    VisaFees: [GL, 'Visa'], PassportRenewal: [GL, 'Passport'], DrivingLicense: LICENSES, GovernmentIDServices: LICENSES,
  },
  Insurance: {
    'Home/RentersInsurance': ['Housing', 'Renters Insurance'], LifeInsurance: ['Health', 'Life Insurance'],
  },
  Remittances: {
    RemitlyTransfer: INDIA, RiaTransfer: INDIA, BankWire: INDIA, TransferFees: INDIA, ExchangeRateAdjustments: INDIA,
  },
};

const BUDGET_MOVES = {
  HousingUtilities: 'Housing', HomeOfficeTech: 'Household', Family: 'Household', Automobile: 'Transport', Travel: VT, Vacation: VT,
  PersonalCare: 'Personal Care', Gifts: 'Gifts & Giving', WorkEducation: 'Work & Education', IdentityLegal: GL, Insurance: 'Health',
};

const FAST_FOOD = /MCDONALD|WENDY|\bKFC\b|BURGER KING|TACO BELL|CHICK.?FIL|SUBWAY|POPEYE|PIZZA HUT|DOMINO|ARBY|DAIRY QUEEN|\bMOE.?S\b|CHIPOTLE/i;
const COFFEE = /STARBUCKS|DUNKIN|COFFEE|\bCAFE\b|CAFE$/i;

/** Where an old category and subcategory now live. Some depend on the merchant. */
function target(cat, sub, text) {
  if (cat === 'Dining' && sub === 'DiningOut') {
    return ['Dining', FAST_FOOD.test(text) ? 'Fast Food' : COFFEE.test(text) ? 'Coffee & Tea' : 'Restaurants'];
  }
  if (cat === 'Insurance' && sub === 'Health/DentalInsurance') {
    return ['Health', /DENTA/i.test(text) ? 'Dental Insurance' : 'Health Insurance'];
  }
  if (cat === 'Gifts' && sub?.startsWith('SpecificBirthdays')) return ['Gifts & Giving', 'Birthdays'];
  if (cat === 'Gifts' && sub === 'GeneralGifting' && /DONATION/i.test(text)) return ['Gifts & Giving', 'Donations'];
  return MOVES[cat]?.[sub] || null;
}

function moveRow(row) {
  const out = { ...row };
  const moved = target(row.cat, row.sub, row.origDesc || row.desc || '');
  if (moved) [out.cat, out.sub] = moved;
  if (row.kind === 'income' && row.sub === 'Other' && (/PAYROLL/i.test(row.desc || '') || /paycheck/i.test(row.bankCategory || ''))) {
    out.sub = 'Salary';
  }
  if (row.splitParent) out.splitParent = moveRow(row.splitParent);
  return out;
}

function moveRule(rule) {
  const out = { ...rule, votes: {} };
  for (const [vote, n] of Object.entries(rule.votes || {})) {
    const [cat, sub] = vote.split('\u0000');
    const [c, s] = target(cat, sub, rule.key) || [cat, sub];
    const next = `${c}\u0000${s}`;
    out.votes[next] = (out.votes[next] || 0) + n;
  }
  if (rule.manual) {
    const moved = target(rule.manual.cat, rule.manual.sub, rule.key);
    out.manual = moved ? { ...rule.manual, cat: moved[0], sub: moved[1] } : rule.manual;
  }
  return out;
}

// One cart at these stores holds many kinds of thing, so they start here and always ask.
const MIXED_STORES = ['WAL MART', 'WM SUPERCENTER', 'WALMART COM', 'AMAZON MKTPL', 'AMAZON MKTPLACE', 'AMAZON COM'];

/** Sets the starting point for mixed stores. What you pick for one purchase says nothing about the next. */
export function pinMixedStores(rules) {
  const next = { ...rules };
  for (const key of MIXED_STORES) {
    next[key] = {
      ...(next[key] || { key, votes: {} }),
      manual: { kind: 'expense', cat: 'Household', sub: 'Mixed Store Run', rowId: 'taxonomy-2' },
      mixed: true,
      storeDefault: true,
    };
  }
  return next;
}

/** Returns the same data under the current categories. Anything the table doesn't know stays as it was. */
export function migrateData({ tx = [], rules, categories, budgets }) {
  const nextRules = pinMixedStores(Object.fromEntries(Object.entries(rules || {}).map(([k, r]) => [k, moveRule(r)])));

  const nextCategories = structuredClone(DEFAULT_CATEGORIES);
  for (const [cat, subs] of Object.entries(categories || {})) {
    for (const sub of subs) {
      const known = target(cat, sub, '') || (nextCategories[cat]?.includes(sub) ? [cat, sub] : null);
      if (known) continue;
      nextCategories[cat] = nextCategories[cat] || [];
      nextCategories[cat].push(sub);
    }
  }

  const nextBudgets = {};
  for (const [cat, cents] of Object.entries(budgets || {})) {
    const name = BUDGET_MOVES[cat] || cat;
    nextBudgets[name] = (nextBudgets[name] || 0) + cents;
  }

  return { tx: tx.map(moveRow), rules: nextRules, categories: nextCategories, budgets: nextBudgets };
}
