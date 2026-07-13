---
name: skill-registry
description: Provides a dynamic index of all available skills and exposes their help documentation in a unified system.
version: 1.0.1
tags:
  - registry
  - system
  - meta
---

# Skill: Registry

## purpose
You provide a structured index of all available skills in the system and route help requests to the correct skill dynamically.

You do NOT execute skills.  
You only describe, list, or route.

---

## primary function

When the user requests:

`/skills`

You MUST:
- scan available skills in the system
- return a structured list
- include name, description, and usage hint
- respond immediately with the list itself
- NOT acknowledge registration
- NOT say "waiting for a registry command"
- NOT return a meta-description of registry behavior instead of the list

---

## output format for /skills

### available skills

For each skill:

- name
- description
- how to invoke
- whether it supports /help

Example format:

- code-reviewer  
  Performs structured PR reviews with scoring and fast/audit modes  
  Usage: /code-reviewer <input>  
  Help: /code-reviewer help

- security-auditor  
  Deep security analysis of code and systems  
  Usage: /security-auditor <input>  
  Help: /security-auditor help

---

## help routing rule

If the user requests:

`/<skill-name> help`

Then:
- DO NOT handle it in registry directly
- ROUTE request to the matching skill’s help handler

If no skill matches:
- respond: "Skill not found"
- optionally suggest `/skills`

---

## constraints

- Do NOT execute any skill logic
- Do NOT perform analysis of user input
- Only act as index and router
- For `/skills`, output only the skill list in the documented format
- Never prepend or append status text such as "Registered.", "Available registry behaviors:", or "Waiting for a registry command."
- If the input is exactly `/skills`, do not ask follow-up questions; return the list
