# Phage Cocktail Dataset Findings

This memo summarizes the current published extraction dataset and what it can realistically support for the phage-cocktail paper questions:

- What should be considered when designing a cocktail: host range, kinetics, genetic relatedness, receptor/resistance, biofilm activity, antibiotic synergy, and safety?
- Can cocktails be tailored toward expanded host range, resistance prevention, biofilm reduction, or antibiotic synergy from limited characteristics such as host range and growth curves?
- Can we predict efficacy for arbitrary cocktail combinations?

## Current Dataset Snapshot

Published Stenotrophomonas maltophilia extraction data currently contains:

| Data type | Published rows | Notes |
| --- | ---: | --- |
| Factor rows | 219 | Curated deterministic extraction rows across design factors |
| Cocktail outcome rows | 8 | All from one three-phage S. maltophilia cocktail paper |
| Papers represented | 9 | Steno-focused phage characterization, resistance, biofilm, and cocktail papers |
| Phage/species focus | S. maltophilia | Current ML-ready set is not yet cross-pathogen |

Factor-row distribution:

| Factor | Rows | Current usefulness |
| --- | ---: | --- |
| Host range | 90 | Most structured signal, especially QH16 EOP table rows |
| Receptor/resistance | 57 | Strong qualitative/mechanistic feature source |
| Kinetics | 25 | Useful but often qualitative; needs more numeric latent period, burst size, adsorption, and AUC values |
| Safety | 19 | Useful as screen/penalty feature, not efficacy predictor |
| Biofilm | 16 | Useful for goal-specific filtering, not enough for general prediction |
| Antibiotic synergy | 12 | Useful signal, but too sparse for supervised synergy prediction |

Published Steno papers represented:

| Paper | DOI | Rows | Main signal |
| --- | --- | ---: | --- |
| Characterization and antimicrobial activity of vB_SmaS_QH16 | 10.3389/fcimb.2025.1610857 | 96 | Host range, biofilm, kinetics, safety |
| StM171 affects antibiotic sensitivity and biofilm formation | 10.3390/v15122455 | 23 | Antibiotic response, biofilm, safety |
| DLP1/DLP2 type IV pili receptor paper | 10.3390/v10060338 | 22 | Receptor/resistance and host-range mechanism |
| BUCT603/BUCT603B1 phage evolution/resistance | 10.1128/jvi.01249-23 | 21 | Resistance evolution and cross-resistance signal |
| DLP3 broad-host-range phage | 10.3389/fmicb.2020.01358 | 19 | Receptor/resistance, safety, host range |
| AXL3 phage characterization | 10.3390/ijms21176338 | 17 | Resistance/receptor and safety signal |
| Three-phage cocktail: ANB28, SBP2phi2, KB824 | 10.1128/aac.01162-24 | 7 factor rows; 8 outcome rows | Cocktail growth suppression, kinetics, host-range comparison |
| vB_SmaS_QH3 cross-genus phage | 10.3389/fmicb.2025.1570665 | 7 | Kinetics, safety |
| XAN_XB1 therapeutic potential | 10.3390/ijms27020944 | 7 | Kinetics and host-range signal |

## Source-Grounding Check

Representative extracted rows were checked against original full-text assets rather than only against the app output. The row snippets for the three-phage cocktail, StM171, DLP3, AXL3, DLP1/DLP2, BUCT603/BUCT603B1, QH3, and XAN_XB1 were grounded in the corresponding paper text.

The QH16 host-range table required special handling because the XML table did not preserve the pipe-joined evidence string exactly. Direct XML inspection confirmed the relevant table structure and rows were present, including strain IDs, specimen source, host-range reactivity, EOP value, and EOP level. Treat QH16 host-range rows as usable, but avoid over-interpreting columns whose positions shift when MLST is missing.

I did not publish the later Staph extraction batch because inspection showed mixed signal/noise: some rows parsed background/reference sentences, some used ambiguous labels like `P3`, and some did not recover cocktail components cleanly. Those rows should be fixed or filtered before entering the modeling set.

## Literature Grounding

The local data aligns with three established scientific themes:

1. Host-range breadth and depth are central to cocktail design. Abedon, Danis-Wlodarczyk, and Wozniak frame cocktail development around spectrum breadth and depth rather than simple phage count alone: [Pharmaceuticals 2021, DOI 10.3390/ph14101019, PMID 34681243](https://pmc.ncbi.nlm.nih.gov/articles/PMC8541335/).
2. Receptor/cross-resistance structure matters for preventing resistance. The relevant modeling idea is not just "more phages"; it is whether bacteria escaping one phage remain vulnerable to another phage using a different receptor or resistance path.
3. Goal-specific cocktails are scientifically plausible. PubMed searches through the Life Science Research plugin found recent literature for genetically diverse cocktails improving efficiency against bacteria ([PMID 37264114](https://pubmed.ncbi.nlm.nih.gov/37264114/)) and phage-antibiotic synergy against MRSA biofilms ([PMID 38411110](https://pubmed.ncbi.nlm.nih.gov/38411110/)). These support separate scoring objectives for host range, resistance suppression, biofilm reduction, and antibiotic synergy.

## Patterns In The Extracted Data

### Host Range

Host range is currently the most model-ready factor because it can be represented as a binary or ordinal phage-by-strain matrix.

The strongest extracted table is QH16:

- vB_SmaS_QH16 has 75 host-range rows.
- Extracted outcomes: 35 susceptible, 38 resistant, 2 unknown.
- Overall susceptible rate among extracted QH16 rows: 35/75 = 46.7%.

Exploratory specimen-source pattern in QH16:

| Specimen source | Susceptible | Total | Rate |
| --- | ---: | ---: | ---: |
| Blood | 14 | 15 | 93.3% |
| Sputum | 16 | 45 | 35.6% |
| BALF | 3 | 7 | 42.9% |

For blood versus sputum in QH16, Fisher's exact test gives an exploratory two-sided p-value of about 0.00017 and an odds ratio around 25.4. This is a real signal in the extracted table, but it is not yet a general biological conclusion because it is one paper, one phage, and specimen source may be confounded with strain lineage, sample collection, and hospital context.

### Kinetics

Kinetics appears important but is not yet numeric enough. The three-phage cocktail paper provides direct evidence that the ANB28 + SBP2phi2 + KB824 cocktail suppressed S. maltophilia growth longer than individual phages, with rows mentioning 40-48 hour suppression and growth-curve comparisons.

This supports Kayla's hypothesis that complementary timing can matter. However, the current extraction mostly captures qualitative growth-curve text. To model kinetics properly, the parser needs:

- latent period
- burst size
- adsorption rate
- AUC under growth curve
- time to rebound
- maximum OD reduction
- suppression duration
- MOI and timepoint context

### Genetic Relatedness

Genetic relatedness is important in the literature and in the three-phage cocktail paper, but the current database does not yet have enough explicit pairwise genome-distance rows. The three-phage cocktail evidence suggests genetically distinct cocktails can outperform genetically similar cocktails in at least one setting, while other work suggests related phages may exchange genetic information more easily. These are not contradictory; they imply genetic relatedness may be goal-dependent:

- broader host range and lower cross-resistance may benefit from genetic/receptor diversity
- adaptive evolution or gene sharing hypotheses may require relatedness or compatible biology

For the paper, genetic relatedness should become a computed feature, not just an extracted sentence. Recommended features:

- pairwise ANI or Mash distance between cocktail phages
- shared-gene fraction
- shared receptor-binding protein similarity
- same/different genus or family
- receptor group diversity
- cross-resistance group diversity

### Receptor And Resistance

This is one of the strongest non-host-range signals in the current dataset. DLP1/DLP2, DLP3, AXL3, and BUCT603/BUCT603B1 all contribute receptor/resistance rows.

The DLP1/DLP2 paper is especially useful because it ties type IV pili to cellular receptor use. This kind of feature can answer Kayla and Ritwik's question in a negative-prediction form: not necessarily "bacteria has X so the phage infects," but "bacteria has Y or lacks/changes receptor pathway Z, so the phage cannot infect or resistance is likely."

For modeling, receptor/resistance is best represented as a resistance-risk feature:

- receptor known versus unknown
- receptor is virulence-associated versus not
- same receptor group overlap inside a cocktail
- observed resistance emergence
- observed cross-resistance
- resistant mutant fitness/virulence cost, when available

### Biofilm

Biofilm data exists but is still sparse. QH16 and StM171 provide the strongest Steno signals.

This is enough for a goal-specific "biofilm evidence present" or "biofilm-prioritized candidate" flag. It is not enough to predict quantitative biofilm reduction for arbitrary cocktails.

### Antibiotic Synergy

StM171 and BUCT603/BUCT603B1 provide the strongest current Steno antibiotic-interaction signals. The literature also supports phage-antibiotic synergy as a separate design goal, especially in biofilms.

The current dataset can support a curated antibiotic-synergy evidence table, but not a trained synergy model. For that, the extraction needs standardized fields:

- antibiotic name
- concentration or MIC fraction
- phage MOI
- host strain
- timepoint
- Bliss/Loewe/FICI or a comparable synergy metric
- biofilm versus planktonic condition
- monotherapy baselines

## Modeling Feasibility

### What We Can Do Now

We can build a rule-based, multi-objective cocktail scorer. This is not yet trained ML, but it is useful and scientifically defensible because the factors map directly onto the research questions.

Prototype scoring structure:

```text
score(cocktail, goal) =
  w_host * host_range_breadth
+ w_depth * multi_hit_depth
+ w_receptor * receptor_group_diversity
+ w_resistance * resistance_escape_penalty_inverse
+ w_kinetics * kinetic_complementarity
+ w_biofilm * biofilm_evidence
+ w_antibiotic * antibiotic_synergy_evidence
+ w_safety * safety_pass
- w_overlap * redundant_overlap_penalty
- w_unknown * missing_data_penalty
```

Goal-specific weighting:

| Goal | Highest-priority features |
| --- | --- |
| Expanded host range | breadth, strain coverage, host-range depth, minimum cocktail size |
| Resistance prevention | receptor diversity, cross-resistance groups, multi-hit depth, mutant fitness costs |
| Biofilm reduction | biofilm assay evidence, matrix penetration, timepoint reduction, antibiotic pairing |
| Antibiotic synergy | antibiotic-specific synergy metric, MIC shift, biofilm/planktonic context, safety |
| General therapeutic suitability | safety, lytic lifestyle, absence of AMR/virulence genes, host range, manufacturability |

### What We Cannot Honestly Do Yet

We cannot train a reliable supervised model to predict arbitrary cocktail efficacy yet. The blocking issue is not total row count; it is outcome diversity.

Current cocktail outcome rows:

- 8 published outcome rows
- all from one Steno cocktail paper
- all centered on ANB28 + SBP2phi2 + KB824
- no broad set of failed/negative cocktail comparators
- limited quantitative effect sizes

A supervised model would overfit immediately and would mostly learn the identity of one paper/cocktail, not general cocktail principles.

## Minimum Dataset Needed For Real ML

For actual ML/statistical modeling, we need a table where each row is a tested cocktail under a defined assay condition.

Minimum useful schema:

| Field group | Required fields |
| --- | --- |
| Cocktail | phage IDs, cocktail size, dose/MOI, component ratios |
| Host | species, strain ID, lineage/MLST, clinical source, resistance profile |
| Host range | each component's susceptible/resistant outcome against the target strain |
| Kinetics | per-phage AUC, suppression duration, rebound time, burst size, latent period |
| Genetics | pairwise genome distance, receptor-binding protein similarity, taxonomy |
| Resistance | receptor group, cross-resistance group, BIM frequency, resistance emergence |
| Biofilm | biofilm/planktonic condition, reduction metric, timepoint |
| Antibiotic | drug, concentration, combination metric, monotherapy baselines |
| Outcome | quantitative kill/growth/biofilm endpoint and categorical success/failure label |

For a first real model, target at least:

- 50-100 tested cocktail-condition rows for rough logistic/ordinal models
- 200+ rows for random forest or gradient boosting with feature importance
- multiple pathogens only if pathogen identity is included as a feature or models are stratified
- both successful and unsuccessful cocktails

## Recommended Next Extraction Priorities

1. Split host-range summaries into per-phage rows when a paper reports multiple phages in one sentence. The three-phage cocktail host-range summary should not be treated as one identical host-range value for ANB28, KB824, and SBP2phi2.
2. Improve table parsers for numeric growth curves and one-step growth assays.
3. Add a genetic-distance enrichment step using genome accessions from extracted phage names.
4. Add a cross-resistance/receptor ontology: type IV pili, LPS, capsule, O-antigen, outer membrane proteins, unknown.
5. Re-run Staph antibiotic-synergy/biofilm papers only after filtering out background/reference rows and improving cocktail component parsing.
6. Prioritize papers with actual cocktail comparators, especially failed or less-effective cocktails, because those are essential for model learning.

## Current Answer To The Research Questions

### What contributes most?

For the current dataset, host range contributes the strongest model-ready signal because it is structured and has enough rows. Receptor/resistance is the next most important because it helps explain why host range may fail and how resistance prevention could be engineered. Kinetics, genetic relatedness, biofilm activity, and antibiotic synergy are scientifically important but need better quantitative extraction before they can compete as statistical predictors.

### Can cocktails be tailored to specific goals?

Yes, but the current data supports goal-specific scoring more than trained prediction. The clearest path is to build separate objective functions:

- host-range maximizer
- resistance-prevention scorer
- biofilm-prioritized scorer
- antibiotic-synergy scorer

These should share the same feature table but use different weights and required evidence.

### Can we predict efficacy for any cocktail combination?

Not yet. We can generate defensible candidate rankings and identify missing evidence, but we cannot claim a general predictive ML model until there are many cocktail-level outcome rows with quantitative endpoints and negative/weak comparators.

## Practical Next Step

The app should treat the current dataset as a curation-and-feature-engineering base, not a finished training set. The next best technical milestone is:

1. export a phage-by-strain host-range matrix for Steno,
2. compute maximum coverage and coverage-depth scores for candidate cocktails,
3. attach receptor/genetic/kinetic/biofilm/synergy annotations as secondary objectives,
4. validate the rankings against Kayla's in-house Steno host-range and growth-curve data.

That would directly answer the paper's core question without overclaiming ML before the outcome data exists.
