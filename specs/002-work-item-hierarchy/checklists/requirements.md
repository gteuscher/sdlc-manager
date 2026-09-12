# Specification Quality Checklist: Work Item Hierarchy

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-11
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Resolved clarification

**FR-020 and FR-021** — how unowned items are presented in a hierarchy — were put to
the maintainer together, since a coherent answer has to cover both directions.
Resolved: **both are shown, visibly marked as not the engineer's work, and excluded
from every count.**

The reasoning is recorded in Assumptions: a list containing only owned items would
render an epic assigned to the engineer, whose stories all belong to teammates, as
an empty group — more misleading than showing the stories and saying whose they are.

Two consequences were added rather than left implicit: **FR-021a** (context items
are excluded from the count and distinguishable without relying on colour) and
**FR-021b** (a context item's attention must not roll up as though the engineer were
being asked to act). Both are the kind of thing that passes a careless reading and
produces a list that overstates what is being asked of the engineer.

### Validation observations

- The request named Jira specifically. The spec deliberately generalises to a
  lifecycle-declared relationship, recorded in a framing note with its
  constitutional justification (Principles II and VI). Reviewed and judged correct:
  a provider-conditional rule would be unimplementable without violating both.
- **FR-012** is the requirement most likely to be under-delivered, because a
  roll-up marker that merely reuses the existing attention badge would pass a
  careless reading. SC-002 exists to make it measurable.
- The spec records a real **dependency on a manifest contract version change**
  (there is no relationship field in contract v1). That is a scope fact worth
  surfacing at planning rather than discovering during implementation.
