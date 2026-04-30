export const SYMPTOMS = [
  { key: "Dysmenorrhea_Painful_Periods",     label: "Dysmenorrhea",                      sub: "Painful menstrual periods",              corr: 0.72 },
  { key: "Chronic_Pelvic_Pain",              label: "Chronic Pelvic Pain",               sub: "Persistent non-cyclic pelvic pain",      corr: 0.68 },
  { key: "Dyspareunia_Pain_During_Sex",      label: "Dyspareunia",                       sub: "Pain during intercourse",                corr: 0.63 },
  { key: "Dyschezia_Pain_During_Bowel_Mvmt", label: "Dyschezia",                         sub: "Pain during bowel movements",            corr: 0.55 },
  { key: "Dysuria_Pain_During_Urination",    label: "Dysuria",                           sub: "Pain during urination",                  corr: 0.40 },
  { key: "Lower_Back_Pain",                  label: "Lower Back Pain",                   sub: "Lumbosacral pain, often cyclic",         corr: 0.42 },
  { key: "Pelvic_Bloating",                  label: "Pelvic Bloating",                   sub: "Pelvic distension or pressure",          corr: 0.50 },
  { key: "Heavy_Menstrual_Bleeding",         label: "Heavy Menstrual Bleeding",          sub: "Menorrhagia",                            corr: 0.48 },
  { key: "Irregular_Periods",                label: "Irregular Periods",                 sub: "Cycle length variation",                 corr: 0.28 },
  { key: "Spotting_Between_Periods",         label: "Intermenstrual Spotting",           sub: "Bleeding between periods",               corr: 0.38 },
  { key: "Premenstrual_Spotting",            label: "Premenstrual Spotting",             sub: "Spotting in days before menses",         corr: 0.35 },
  { key: "Nausea_Vomiting",                  label: "Nausea / Vomiting",                 sub: "Especially during menses",               corr: 0.42 },
  { key: "Bloating_GI",                      label: "GI Bloating",                       sub: "Abdominal distension",                   corr: 0.40 },
  { key: "Constipation",                     label: "Constipation",                      sub: "Often catamenial",                       corr: 0.32 },
  { key: "Diarrhea",                         label: "Diarrhea",                          sub: "Often catamenial",                       corr: 0.28 },
  { key: "Rectal_Pain",                      label: "Rectal Pain",                       sub: "May indicate deep infiltration",         corr: 0.50 },
  { key: "Frequent_Urination",               label: "Frequent Urination",                sub: "Increased urinary frequency",            corr: 0.28 },
  { key: "Urinary_Urgency",                  label: "Urinary Urgency",                   sub: "Sudden compelling need to void",         corr: 0.30 },
  { key: "Blood_In_Urine_Hematuria",         label: "Hematuria",                         sub: "Blood in urine",                         corr: 0.38 },
  { key: "Fatigue",                          label: "Fatigue",                           sub: "Persistent low energy",                  corr: 0.55 },
  { key: "Mood_Changes_Anxiety_Depression",  label: "Mood Changes",                      sub: "Anxiety, depression",                    corr: 0.42 },
  { key: "Brain_Fog",                        label: "Brain Fog",                         sub: "Cognitive slowing",                      corr: 0.48 },
  { key: "Leg_Pain_Sciatica",                label: "Leg Pain / Sciatica",               sub: "Radiating lower-extremity pain",         corr: 0.38 },
  { key: "Shoulder_Pain",                    label: "Shoulder Pain",                     sub: "May indicate diaphragmatic involvement", corr: 0.25 },
  { key: "Infertility_Or_Subfertility",      label: "Infertility / Subfertility",        sub: "Difficulty conceiving",                  corr: 0.58 }
];

export const CLUSTERS = [
  { id: 1, name: "Very Low",  range: [0.00, 1.40],  diagnosed_pct: 14, color: "#2d5a2d" },
  { id: 2, name: "Low",       range: [1.40, 2.85],  diagnosed_pct: 32, color: "#6b7a2d" },
  { id: 3, name: "Moderate",  range: [2.85, 4.40],  diagnosed_pct: 56, color: "#b08800" },
  { id: 4, name: "High",      range: [4.40, 5.95],  diagnosed_pct: 78, color: "#c2410c" },
  { id: 5, name: "Very High", range: [5.95, 11.10], diagnosed_pct: 94, color: "#8b1e1e" }
];

export const TOTAL_MAX = 11.10;

export const CLUSTER_HEADLINES = {
  1: "Reassuring findings.",
  2: "Low-probability profile.",
  3: "Moderate clinical concern.",
  4: "High-suspicion presentation.",
  5: "Highly suggestive profile."
};

export const CLUSTER_RECOMMENDATIONS = {
  1: "Routine surveillance is appropriate. No urgent specialist referral indicated at this time. Consider re-evaluation if symptom burden increases or new symptoms emerge. Standard preventive gynecological care and patient education are recommended.",
  2: "A watchful waiting approach with scheduled follow-up in 3–6 months is suggested. Document symptom progression. Consider hormonal cycle tracking and pelvic examination. Referral may be warranted if symptoms intensify or fertility concerns arise.",
  3: "Consider referral to a gynecologist for further evaluation. Transvaginal ultrasound is an appropriate first-line imaging modality. Hormonal management trials may be discussed with the patient. Document symptom chronology thoroughly for specialist handover.",
  4: "Prompt gynecological referral is strongly recommended. Pelvic MRI should be considered to evaluate for deep infiltrating endometriosis. Multidisciplinary coordination (gynecology, gastroenterology, urology) may be warranted depending on the symptom constellation. Early intervention may improve long-term outcomes.",
  5: "Urgent specialist referral is indicated. This presentation warrants comprehensive evaluation including pelvic MRI and surgical consultation. A multidisciplinary team approach — encompassing gynecology, reproductive medicine, colorectal surgery, and urology as appropriate — is recommended. Laparoscopic staging and histological confirmation should be prioritized."
};
