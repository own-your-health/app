// What the common tests are, in plain words: a name, and for most one or two
// sentences on what the test measures and what a high or low result can
// go with. Written for this app from MedlinePlus (National Library of
// Medicine), whose lab test and encyclopedia pages each entry's `page`
// names, and checked against that page; every claim is one the page makes. They stop at the general case: a person's own result is
// read only against the lab's range, and its meaning is for their doctor.

export interface LabTest {
  name: string;
  about?: string;
  /** The MedlinePlus page the sentences follow. */
  page?: string;
}

const MP = 'https://medlineplus.gov/lab-tests/';

const glucose: LabTest = {
  name: 'Glucose',
  about: 'Glucose is the main sugar in the blood and the body’s main source of energy. A high level can be a sign of diabetes or prediabetes; a low level most often comes from diabetes medicines, especially with too little food, and is uncommon without diabetes.',
  page: `${MP}blood-glucose-test/`,
};
const egfr: LabTest = {
  name: 'eGFR (kidney filtering)',
  about: 'eGFR estimates how well the kidneys filter the blood, worked out from a creatinine result and things such as age and sex. A low eGFR can be a sign of kidney disease.',
  page: `${MP}estimated-glomerular-filtration-rate-egfr-and-gfr-tests/`,
};
const ldl: LabTest = {
  name: 'LDL cholesterol',
  about: 'LDL is the “bad” cholesterol, which can build up in the walls of the arteries. A high level can raise the risk of heart disease and stroke.',
  page: `${MP}cholesterol-levels/`,
};
const a1c: LabTest = {
  name: 'A1c',
  about: 'A1c shows the average blood sugar over the past two to three months. A high level can be a sign of diabetes or prediabetes; for someone with diabetes, it shows how well it is controlled.',
  page: `${MP}hemoglobin-a1c-hba1c-test/`,
};
const bilirubin: LabTest = {
  name: 'Bilirubin',
  about: 'Bilirubin is a yellow substance made when red blood cells break down, which the liver clears. A high level can be a sign of a liver or bile duct problem, or of red blood cells breaking down faster than usual.',
  page: `${MP}bilirubin-blood-test/`,
};
const platelets: LabTest = {
  name: 'Platelets',
  about: 'Platelets help the blood clot. A low count can lead to easy bruising or bleeding; a high count can go with infection, inflammation, anemia or blood loss.',
  page: `${MP}platelet-tests/`,
};
const neutrophils: LabTest = {
  name: 'Neutrophils',
  about: 'Neutrophils are the most common white blood cells and mostly fight bacterial infections. A high count can go with infection, inflammation or stress; a low count with some viral infections, chemotherapy or bone marrow problems.',
  page: `https://medlineplus.gov/ency/article/003657.htm`,
};
const lymphocytes: LabTest = {
  name: 'Lymphocytes',
  about: 'Lymphocytes are white blood cells that mostly fight viral infections. A high count can go with a viral infection; a low count with some infections, some medicines or immune problems.',
  page: 'https://medlineplus.gov/ency/article/003657.htm',
};
const monocytes: LabTest = {
  name: 'Monocytes',
  about: 'Monocytes are white blood cells that kill germs and clear away dead cells. A high count can go with some infections or a long-lasting inflammatory disease.',
  page: 'https://medlineplus.gov/ency/article/003657.htm',
};
const eosinophils: LabTest = {
  name: 'Eosinophils',
  about: 'Eosinophils are white blood cells that fight parasites and take part in allergic reactions. A high count can go with allergies, asthma, eczema or a parasite infection.',
  page: 'https://medlineplus.gov/ency/article/003649.htm',
};
const basophils: LabTest = {
  name: 'Basophils',
  about: 'Basophils are the least common white blood cells and release substances during allergic reactions and asthma attacks. A high count can go with an allergic reaction or some bone marrow disorders.',
  page: 'https://medlineplus.gov/ency/article/003657.htm',
};
const tsh: LabTest = {
  name: 'TSH (thyroid)',
  about: 'TSH is the hormone that tells the thyroid how much thyroid hormone to make. A high level can be a sign of an underactive thyroid; a low level, of an overactive one.',
  page: `${MP}tsh-thyroid-stimulating-hormone-test/`,
};
const vitaminD: LabTest = {
  name: 'Vitamin D',
  about: 'This measures 25-hydroxy vitamin D, the form that shows how much vitamin D the body has. A low level can weaken the bones; a very high level, usually from too many supplements, can cause serious health problems.',
  page: `${MP}vitamin-d-test/`,
};
/** A reading of both numbers, under either of its two codes. */
const pressure: LabTest = {
  name: 'Blood pressure',
  about: 'The top number is the pressure in the arteries when the heart beats, and the bottom number is the pressure when it rests between beats.',
  page: `${MP}measuring-blood-pressure/`,
};

const oxygen: LabTest = {
  name: 'Oxygen level',
  about: 'Oxygen saturation shows how much oxygen the red blood cells are carrying. A low level can be a sign of a lung or heart problem.',
  page: `${MP}pulse-oximetry/`,
};
const vitaminD3: LabTest = {
  name: 'Vitamin D3',
  about: 'This measures 25-hydroxy vitamin D3, the main form of vitamin D the body stores. A low level can weaken the bones; a very high level, usually from too many supplements, can cause serious health problems.',
  page: `${MP}vitamin-d-test/`,
};
const weight: LabTest = { name: 'Weight' };
const headCircumference: LabTest = { name: 'Head size' };

/** By LOINC code: every code in panels.ts, and the rest of a blood count. */
export const LAB_TESTS: Record<string, LabTest> = {
  // Metabolic panel
  '2345-7': glucose,
  '2339-0': glucose,
  '3094-0': {
    name: 'BUN (urea nitrogen)',
    about: 'Blood urea nitrogen is a waste product the kidneys filter out of the blood. A high level can be a sign the kidneys are not working well, or of dehydration.',
    page: `${MP}bun-blood-urea-nitrogen/`,
  },
  '2160-0': {
    name: 'Creatinine',
    about: 'Creatinine is a waste product from the muscles that the kidneys filter out of the blood. A high level can be a sign the kidneys are not working well.',
    page: `${MP}creatinine-test/`,
  },
  '33914-3': egfr,
  '48642-3': egfr,
  '48643-1': egfr,
  '62238-1': egfr,
  '98979-8': egfr,
  '2951-2': {
    name: 'Sodium',
    about: 'Sodium is an electrolyte that helps keep the body’s fluids in balance and the nerves and muscles working. A high level often goes with dehydration; a low level can come from vomiting or diarrhea, some medicines, or heart, kidney or liver problems.',
    page: `${MP}sodium-blood-test/`,
  },
  '2823-3': {
    name: 'Potassium',
    about: 'Potassium is an electrolyte the heart, nerves and muscles need to work. A level that is too high or too low can affect the heart’s rhythm; kidney problems, some medicines, and vomiting or diarrhea can change it.',
    page: `${MP}potassium-blood-test/`,
  },
  '2075-0': {
    name: 'Chloride',
    about: 'Chloride is an electrolyte, found mostly in salt, that helps control the amount of fluid in the body. A high or low level can go with dehydration, vomiting or diarrhea, kidney or heart problems, or an upset in the blood’s acid and base balance.',
    page: `${MP}chloride-blood-test/`,
  },
  '2028-9': {
    name: 'CO2 (bicarbonate)',
    about: 'Carbon dioxide, mostly as bicarbonate, helps keep the blood’s acid and base in balance. A high or low level can be a sign of a lung, kidney or metabolic problem that upsets that balance.',
    page: `${MP}carbon-dioxide-co2-in-blood/`,
  },
  '17861-6': {
    name: 'Calcium',
    about: 'Calcium is a mineral the bones, heart, nerves and muscles need. A high level can go with overactive parathyroid glands, some cancers or too much vitamin D; a low level with low vitamin D, low albumin or kidney problems.',
    page: `${MP}calcium-blood-test/`,
  },
  // Cholesterol
  '2093-3': {
    name: 'Total cholesterol',
    about: 'Total cholesterol is all the cholesterol in the blood, including LDL and HDL. A high level can raise the risk of heart disease and stroke.',
    page: `${MP}cholesterol-levels/`,
  },
  '2571-8': {
    name: 'Triglycerides',
    about: 'Triglycerides are a type of fat in the blood that stores energy from food. A high level can raise the risk of heart disease, and a very high level the risk of pancreatitis.',
    page: `${MP}triglycerides-test/`,
  },
  '2085-9': {
    name: 'HDL cholesterol',
    about: 'HDL is the “good” cholesterol, which carries cholesterol away to the liver. A low level can raise the risk of heart disease.',
    page: 'https://medlineplus.gov/hdlthegoodcholesterol.html',
  },
  '13457-7': ldl,
  '18262-6': ldl,
  '43396-1': {
    name: 'Non-HDL cholesterol',
    about: 'Non-HDL cholesterol is total cholesterol minus HDL: all the cholesterol that can build up in the arteries. A high level can raise the risk of heart disease.',
    page: 'https://medlineplus.gov/cholesterollevelswhatyouneedtoknow.html',
  },
  // MedlinePlus has no page on the ratio, so it gets a name and no sentence.
  '9830-1': { name: 'Cholesterol to HDL ratio' },
  // Blood sugar
  '4548-4': a1c,
  '17856-6': a1c,
  '27353-2': {
    name: 'Estimated average glucose',
    about: 'The A1c result as an average blood sugar, in the same units a glucose test uses.',
    page: 'https://medlineplus.gov/ency/patientinstructions/000966.htm',
  },
  '1558-6': {
    name: 'Fasting glucose',
    about: 'Blood sugar measured after not eating for at least eight hours. A high level can be a sign of diabetes or prediabetes.',
    page: `${MP}blood-glucose-test/`,
  },
  // Liver
  '1742-6': {
    name: 'ALT (liver enzyme)',
    about: 'ALT is an enzyme found mostly in the liver. A high level can be a sign of liver damage, such as from hepatitis, alcohol, other liver diseases or some medicines.',
    page: `${MP}alt-blood-test/`,
  },
  '1920-8': {
    name: 'AST (liver enzyme)',
    about: 'AST is an enzyme found mostly in the liver, and also in the heart and muscles. A high level can be a sign of liver damage, or of damage to the heart or muscles.',
    page: `${MP}ast-test/`,
  },
  '6768-6': {
    name: 'Alkaline phosphatase',
    about: 'Alkaline phosphatase is an enzyme found mostly in the liver and the bones. A high level can be a sign of a liver, bile duct or bone problem; it is normally higher in children and teens, whose bones are growing.',
    page: `${MP}alkaline-phosphatase/`,
  },
  '1975-2': bilirubin,
  '42719-5': bilirubin,
  '2885-2': {
    name: 'Total protein',
    about: 'Total protein measures albumin and the other proteins in the blood. A low level can be a sign of a liver or kidney problem or of poor nutrition; a high level can go with some infections or blood cancers.',
    page: `${MP}total-protein-and-albumin-globulin-a-g-ratio/`,
  },
  '1751-7': {
    name: 'Albumin',
    about: 'Albumin is the main protein in the blood and is made by the liver; it keeps fluid inside the blood vessels. A low level can be a sign of liver or kidney disease or of poor nutrition.',
    page: `${MP}albumin-blood-test/`,
  },
  // Blood count
  '6690-2': {
    name: 'White blood cells',
    about: 'White blood cells fight infection. A high count can go with an infection, inflammation or stress; a low count with some infections, medicines or bone marrow problems.',
    page: `${MP}white-blood-count-wbc/`,
  },
  '789-8': {
    name: 'Red blood cells',
    about: 'Red blood cells carry oxygen from the lungs to the rest of the body. A low count can be a sign of anemia; a high count can go with dehydration, lung or heart disease, or a bone marrow disorder.',
    page: `${MP}red-blood-cell-rbc-count/`,
  },
  '718-7': {
    name: 'Hemoglobin',
    about: 'Hemoglobin is the protein in red blood cells that carries oxygen. A low level can be a sign of anemia; a high level can go with dehydration, smoking, living at a high altitude, or lung or heart disease.',
    page: `${MP}hemoglobin-test/`,
  },
  '4544-3': {
    name: 'Hematocrit',
    about: 'Hematocrit is the share of the blood made up of red blood cells. A low level can be a sign of anemia; a high level can go with dehydration or with the body making too many red cells.',
    page: `${MP}hematocrit-test/`,
  },
  '787-2': {
    name: 'MCV (red cell size)',
    about: 'MCV is the average size of the red blood cells. It helps tell kinds of anemia apart: small cells often go with low iron, large cells with low vitamin B12 or folate.',
    page: `${MP}mcv-mean-corpuscular-volume/`,
  },
  '785-6': {
    name: 'MCH (hemoglobin per red cell)',
    about: 'MCH is the average amount of hemoglobin in each red blood cell. Like MCV, it helps tell kinds of anemia apart.',
    page: `${MP}red-blood-cell-rbc-indices/`,
  },
  '786-4': {
    name: 'MCHC (hemoglobin concentration)',
    about: 'MCHC is how concentrated the hemoglobin is inside the red blood cells. A low level can go with anemia from low iron.',
    page: `${MP}red-blood-cell-rbc-indices/`,
  },
  '788-0': {
    name: 'RDW (red cell size range)',
    about: 'RDW measures how much the red blood cells vary in size. A high value means they vary more than usual; read with the rest of the blood count, it helps find the cause of anemia.',
    page: `${MP}rdw-red-cell-distribution-width/`,
  },
  '777-3': platelets,
  '26515-7': platelets,
  '32623-1': {
    name: 'MPV (platelet size)',
    about: 'MPV is the average size of the platelets. It is read together with the platelet count.',
    page: `${MP}mpv-blood-test/`,
  },
  '751-8': neutrophils,
  '770-8': { ...neutrophils, name: 'Neutrophils (%)' },
  '731-0': lymphocytes,
  '736-9': { ...lymphocytes, name: 'Lymphocytes (%)' },
  '742-7': monocytes,
  '5905-5': { ...monocytes, name: 'Monocytes (%)' },
  '711-2': eosinophils,
  '713-8': { ...eosinophils, name: 'Eosinophils (%)' },
  '704-7': basophils,
  '706-2': { ...basophils, name: 'Basophils (%)' },
  // Thyroid
  '3016-3': tsh,
  '11580-8': tsh,
  '3024-7': {
    name: 'Free T4 (thyroid hormone)',
    about: 'Free T4 is the main hormone the thyroid makes, in the form the body can use. A low level can be a sign of an underactive thyroid; a high level, of an overactive one.',
    page: `${MP}thyroxine-t4-test/`,
  },
  '3051-0': {
    name: 'Free T3 (thyroid hormone)',
    about: 'Free T3 is the active form of T3, one of the two hormones the thyroid makes. A high level can be a sign of an overactive thyroid.',
    page: `${MP}triiodothyronine-t3-tests/`,
  },
  // Vitamins and iron
  '62292-8': vitaminD,
  '1989-3': vitaminD3,
  '14635-7': vitaminD3,
  '2132-9': {
    name: 'Vitamin B12',
    about: 'Vitamin B12 is needed to make red blood cells and keep the nerves healthy. A low level can lead to anemia and nerve problems.',
    page: `${MP}vitamin-b-test/`,
  },
  '2284-8': {
    name: 'Folate',
    about: 'Folate (vitamin B9) is needed to make red blood cells and new cells. A low level can lead to anemia; getting enough matters most before and during pregnancy.',
    page: 'https://medlineplus.gov/ency/article/003686.htm',
  },
  '2498-4': {
    name: 'Iron',
    about: 'Iron is needed to make hemoglobin. A low level can lead to anemia; a high level can go with iron overload.',
    page: `${MP}iron-tests/`,
  },
  '2500-7': {
    name: 'Iron-binding capacity (TIBC)',
    about: 'TIBC shows how well transferrin, the protein that carries iron in the blood, can carry iron. A high value often goes with low iron; a low value with inflammation, liver disease or poor nutrition.',
    page: 'https://medlineplus.gov/ency/article/003489.htm',
  },
  '2276-4': {
    name: 'Ferritin',
    about: 'Ferritin is the protein that stores iron, so it shows how much iron the body has stored. A low level can be a sign of low iron; a high level can go with iron overload, inflammation or liver disease.',
    page: `${MP}ferritin-blood-test/`,
  },
  // Urine and kidney
  '14959-1': {
    name: 'Urine albumin to creatinine ratio',
    about: 'This compares albumin, a protein, with creatinine in the urine. A high ratio can be an early sign of kidney damage, often from diabetes or high blood pressure.',
    page: `${MP}microalbumin-creatinine-ratio/`,
  },
  '2888-6': {
    name: 'Protein in urine',
    about: 'Healthy kidneys keep almost all protein in the blood. Protein in the urine can be a sign of kidney disease, and can also follow hard exercise, dehydration or stress.',
    page: `${MP}protein-in-urine/`,
  },
  '5811-5': {
    name: 'Urine concentration (specific gravity)',
    about: 'Specific gravity shows how concentrated the urine is. A high value can go with dehydration; a low value can follow drinking a lot or go with some kidney problems.',
    page: 'https://medlineplus.gov/ency/article/003587.htm',
  },
  '5803-2': {
    name: 'Urine pH',
    about: 'pH shows how acidic the urine is. It changes with diet and some medicines, and some kinds of kidney stones form more easily when it is high or low.',
    page: 'https://medlineplus.gov/ency/article/003583.htm',
  },
  // Vital signs
  '85354-9': pressure,
  '55284-4': pressure,
  '8480-6': {
    name: 'Blood pressure, top number',
    about: 'Systolic pressure is the pressure in the arteries when the heart beats. Blood pressure that is high on several different days can be a sign of high blood pressure, which raises the risk of heart attack and stroke.',
    page: `${MP}measuring-blood-pressure/`,
  },
  '8462-4': {
    name: 'Blood pressure, bottom number',
    about: 'Diastolic pressure is the pressure in the arteries when the heart rests between beats. A high bottom number on several different days can also be a sign of high blood pressure.',
    page: `${MP}measuring-blood-pressure/`,
  },
  '8867-4': {
    name: 'Heart rate',
    about: 'How many times the heart beats in a minute. It changes with activity and fitness, and can be faster with an infection or dehydration.',
    page: 'https://medlineplus.gov/ency/article/003399.htm',
  },
  '8310-5': { name: 'Temperature' },
  '9279-1': { name: 'Breathing rate' },
  '59408-5': oxygen,
  // LOINC's blood-gas code, which FHIR's vital-signs profile also puts on a pulse oximeter reading.
  '2708-6': { ...oxygen, page: `${MP}arterial-blood-gas-abg-test/` },
  '29463-7': weight,
  '3141-9': weight,
  '8302-2': { name: 'Height' },
  '39156-5': {
    name: 'BMI (body mass index)',
    about: 'Body mass index is weight relative to height. It is a rough screening measure and does not tell fat from muscle.',
    page: 'https://medlineplus.gov/ency/article/007196.htm',
  },
  '9843-4': headCircumference,
  '8287-5': headCircumference,
};

const LOINC = /loinc/i;

/** The curated entry for a coded record, when it is one. */
/** Whether a code system is LOINC's, however a source writes it ("http://loinc.org", "LOINC"). */
export const isLoinc = (system: string | undefined): boolean => !!system && LOINC.test(system);

export function labTest(code: { system?: string; code?: string } | undefined): LabTest | undefined {
  return code?.code && isLoinc(code.system) && Object.hasOwn(LAB_TESTS, code.code) ? LAB_TESTS[code.code] : undefined;
}

const PLAIN_SPECIMENS = /^(blood|serum or plasma|serum|plasma|arterial blood|venous blood|capillary blood)$/i;

/**
 * A LOINC long name in plain words: "Eosinophils [#/volume] in Blood by
 * Automated count" is "Eosinophils", "Protein [Mass/volume] in Urine" is
 * "Protein in urine". Undefined when the name is not in that form.
 */
export function plainLoincName(long: string | undefined): string | undefined {
  const m = long ? /^(.+?)\s*\[[^\]]*\]\s*in\s+(.+?)(?:\s+by\s+.+)?$/i.exec(long.trim()) : null;
  if (!m) return undefined;
  const [, what, specimen] = m;
  const name = what!.replace(/\.(?=\w)/g, ' ').trim();
  return PLAIN_SPECIMENS.test(specimen!.trim()) ? name : `${name} in ${specimen!.trim().toLowerCase()}`;
}

/**
 * A result's name in plain words: the curated name for its code, else the
 * source's own name (made plain when it is a LOINC long name), else the
 * code's name.
 */
export function resultName(r: { display?: string; code?: { system?: string; code?: string; display?: string } }): string {
  const curated = labTest(r.code)?.name;
  if (curated) return curated;
  const own = r.display?.trim();
  if (own) return plainLoincName(own) ?? own;
  const coded = r.code?.display?.trim();
  return (coded && (plainLoincName(coded) ?? coded)) || 'Result';
}
