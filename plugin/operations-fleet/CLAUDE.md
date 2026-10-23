# Repository instructions

This repository is one Claude Code plugin. Keep it simple and evidence-driven.

- Put reusable expert methods in `skills/<name>/SKILL.md`.
- Keep one skill per recognizable business task.
- Put provider depth and examples in `references/`.
- Put exact repeatable validation or transformations in `scripts/`.
- Use `research` for changing public facts and cite official sources.
- Never send private client data to public search.
- Keep client mappings and simple policy in one `operations.yaml` file.
- Keep SOPs, runbooks, owners, and business definitions in knowledge.
- Keep credentials in OAuth, managed identity, environment variables, or a secret manager.
- Do not add another plugin, package layer, version file, generated demo output, or formal contract framework without demonstrated need.
- A skill must improve a realistic result compared with plain Claude.

Run `python tools/validate_plugin.py` and `python -m unittest discover -s tests` after changes.
