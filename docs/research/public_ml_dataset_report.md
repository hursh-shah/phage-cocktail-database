# Public Supervised ML Dataset Report

## Dataset Built

The public pipeline created a canonical supervised dataset from direct public assets, local published Steno rows, and source-checked curated comparator rows from open papers.

Outputs:

- `data/public_ml/processed/canonical_supervised_rows.jsonl`
- `data/public_ml/processed/canonical_supervised_rows.csv`
- `data/public_ml/processed/model_results.json`
- `data/public_ml/processed/cocktail_scores.csv`
- `data/public_ml/processed/source_audit.json`

Rows by source:

| Source | Rows |
| --- | ---: |
| lbnl_phage_foundry | 923 |
| local_steno_published | 200 |
| upec_uti89_rapid_cocktail | 14 |
| pseudomonas_genetically_diverse_cocktails | 12 |
| pnas_ecoli_predictive_phage | 1 |

Rows by task:

| Task | Rows |
| --- | ---: |
| host_range | 1021 |
| receptor_resistance | 57 |
| kinetics | 27 |
| biofilm | 16 |
| cocktail_growth_suppression | 16 |
| antibiotic_synergy | 12 |
| source_inventory | 1 |

## Acceptance Check

| Criterion | Current value | Met |
| --- | ---: | --- |
| Host-range rows for supervised ML | 1004 | no |
| Cocktail-condition rows | 16 | no |
| Cocktail comparator sources | 2 | no |
| Source-audit coverage | 100.0% | yes |

The host-range model is now executable, but the planned 3,000+ interaction threshold is not met because the PNAS SI interaction matrix was not retrieved as machine-readable tables in this run. The pipeline explicitly records that blocker rather than inventing labels.

## Source Audit

| Source | Status | Checks | Note |
| --- | --- | --- | --- |
| LBNL Phage Foundry | passed | phage metadata rows=260<br>EOP rows=923<br>network nodes=2017<br>network edges=115149 | Direct TSV/CSV assets were downloaded from the public Phage Foundry data browser; no prose extraction was used. |
| Local Supabase Steno rows | passed | published factor rows=219<br>canonical rows=200 | Rows are existing published/curated app data; duplicated pending Steno extractions were not approved. |
| Predictive phage therapy for Escherichia coli urinary tract infections: Cocktail selection for therapy based on machine learning models | blocked_machine_readable_tables | 31 phage mentioned: yes<br>314 strains mentioned: yes<br>interaction score definition: yes<br>SI Table S1 mentioned: yes<br>SI Table S6 mentioned: yes | The primary article text confirms the >9,000 interaction matrix, but the tables are in a supplementary appendix PDF rather than an API-reachable CSV/XLSX in this run. This source should be manually downloaded or PDF-table parsed before full host-range ML claims. |
| Combination of genetically diverse Pseudomonas phages enhances the cocktail efficiency against bacteria | passed | six cocktail formulas: yes<br>4 to 6 log difference statement: yes<br>regrowth suppression statement: yes<br>GenBank OP875100.2: yes<br>GenBank OP875101.1: yes | Curated rows use paper text, not figure digitization; numeric CFU values remain figure-derived and should be digitized before quantitative cocktail ML. |
| Rapid formulation of a genetically diverse phage cocktail targeting uropathogenic Escherichia coli infections using the UTI89 model | passed | SR02+SR04 combination: yes<br>regrowth statement: yes<br>host-range statement: yes<br>GenBank OQ870566: yes<br>GenBank OQ870567: yes | Curated rows use explicit paper text. Growth-curve values should be digitized from figures for quantitative modeling. |

## Host-Range Model

Status: `trained_baseline_logistic_ridge`

Rows: 1004

Mean AUROC: 0.7834

Mean F1: 0.7646

Mean Brier score: 0.1875

Class balance: active=605, inactive=399

Permutation importance, measured as AUROC drop on a held-out fold:

| Feature group | AUROC drop |
| --- | ---: |
| host | 0.0962 |
| lps | 0.0774 |
| taxonomy | 0.0234 |
| receptor | 0.0212 |
| morphotype | 0.0037 |
| pathogen | 0.0028 |
| source | 0.0008 |
| lifestyle | -0.0014 |

## Cocktail Scoring Prototype

This is a ranking model, not supervised cocktail ML. It combines suppression evidence, enhancement over single phages, rebound/resistance signal, receptor diversity, and cocktail size.

| Pathogen | Cocktail | Time h | Score | Enhanced | Rebound/resistance | Source |
| --- | --- | ---: | ---: | --- | --- | --- |
| E_coli | SR02 + SR04 | 16 | 0.9387 | true | false | upec_uti89_rapid_cocktail |
| E_coli | SR02 + SR04 + Zappy | 16 | 0.9387 | true | false | upec_uti89_rapid_cocktail |
| P_aeruginosa | SPA05 + PhiKZ | 24 | 0.9177 | true | false | pseudomonas_genetically_diverse_cocktails |
| P_aeruginosa | SPA05 + PhiKZ | 48 | 0.9177 | true | false | pseudomonas_genetically_diverse_cocktails |
| P_aeruginosa | SPA01 + PhiKZ | 24 | 0.9142 | true | false | pseudomonas_genetically_diverse_cocktails |
| P_aeruginosa | SPA01 + PhiKZ | 48 | 0.9142 | true | false | pseudomonas_genetically_diverse_cocktails |
| P_aeruginosa | PhiKZ + PhiPA3 | 24 | 0.9037 | true | false | pseudomonas_genetically_diverse_cocktails |
| P_aeruginosa | PhiKZ + PhiPA3 | 48 | 0.9037 | true | false | pseudomonas_genetically_diverse_cocktails |
| P_aeruginosa | SPA01 + PhiPA3 | 24 | 0.8897 | true | false | pseudomonas_genetically_diverse_cocktails |
| P_aeruginosa | SPA01 + PhiPA3 | 48 | 0.8827 | true | false | pseudomonas_genetically_diverse_cocktails |

## What This Supports Now

- **Expanded host range:** supported as a supervised host-range/infectivity task, but not yet at the 3,000-row target.
- **Resistance prevention:** supported as a curated/scoring task using Pseudomonas and Steno resistance evidence; needs more numeric rebound/revival rows for supervised ML.
- **Kinetics:** feature extraction is present for UPEC and Steno, but quantitative growth-curve digitization is still needed.
- **Biofilm and antibiotic synergy:** current rows support evidence flags and curation, not reliable supervised prediction.
- **Genetic relatedness:** implemented as categorical/ordinal features for curated cocktail rows and as network-degree metadata for LBNL. Pairwise ANI/Mash still needs a genome-distance enrichment step.

## Next Data Work

1. Retrieve or manually export PNAS SI Tables S1, S5, and S6 into CSV/XLSX; this is the single biggest jump toward the 3,000-row host-range criterion.
2. Digitize Fig. 4D/E from the Pseudomonas cocktail paper and Fig. 1b/c from the UPEC paper to replace curated ordinal labels with numeric CFU/AUC labels.
3. Fix the noisy Staph extractor before publishing MRSA biofilm/synergy rows.
4. Add genome-distance enrichment for every phage with a genome accession.
