# Medical records (managed by medrec)

This folder holds a household's medical records, filed by `medrec`
(https://github.com/own-your-health/medrec-cli). Every file is a plain file you can
open in the Drive app.

- `household.json`: the people, organizations and sources.
- `inbox/`: drop documents here; `medrec intake --inbox` files them.
- `_review/`: documents medrec could not file on its own; `medrec review`.
- One folder per person:
  - `notes.md`: dated notes.
  - `Documents/<year>/`: scans and files, named
    `<date>_<type>_<organization>_<details>_<original name>`.
  - `Claims/<year>/`: explanations of benefits and bills.
  - `Imaging/<date>_<modality>_<body part>_<facility>/`: imaging studies,
    their DICOM files exactly as received, and `study.json`.
  - `Records/<source>/<resource type>/<id>.json`: records from providers
    and insurers, exactly as their systems sent them (FHIR R4).
  - `index.json`, `text.json`: medrec's index of the files above and their
    extracted text. medrec keeps them; do not edit them by hand.

Rules: medrec never edits a filed document or a raw record. Rename or move
files through medrec, so the index stays right; `medrec verify` checks every
file against the index.
