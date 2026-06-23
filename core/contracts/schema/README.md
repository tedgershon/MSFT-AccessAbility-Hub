# Contracts schema

This directory holds the **source of truth** for the cross-language interfaces.

In the full build, the JSON Schema (and/or Protobuf) here is compiled into:

- TypeScript types -> consumed directly under `../src`
- Python types -> consumed under `../python/aah_contracts`

For the scaffold, the TS types (`../src`) and Python dataclasses
(`../python/aah_contracts`) are authored by hand to mirror these schemas. Wire up
a generator (e.g. `json-schema-to-typescript` + `datamodel-code-generator`) to make
this directory authoritative.
