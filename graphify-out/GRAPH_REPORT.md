# Graph Report - .  (2026-06-26)

## Corpus Check
- 78 files · ~343,623 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 247 nodes · 265 edges · 32 communities (11 shown, 21 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Design System Components|Design System Components]]
- [[_COMMUNITY_DS Docs & Agent Instructions|DS Docs & Agent Instructions]]
- [[_COMMUNITY_App Pages & Routes|App Pages & Routes]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Homepage Live Scores|Homepage Live Scores]]
- [[_COMMUNITY_Tournament Bracket View|Tournament Bracket View]]
- [[_COMMUNITY_Brand & Visual Assets|Brand & Visual Assets]]
- [[_COMMUNITY_Tournament Creator|Tournament Creator]]
- [[_COMMUNITY_Next.js Default Assets|Next.js Default Assets]]
- [[_COMMUNITY_Login Page|Login Page]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_Login Layout|Login Layout]]
- [[_COMMUNITY_MatchCard Types|MatchCard Types]]
- [[_COMMUNITY_Claude Settings|Claude Settings]]
- [[_COMMUNITY_SegmentedControl Types|SegmentedControl Types]]
- [[_COMMUNITY_Icon Types|Icon Types]]
- [[_COMMUNITY_Button Types|Button Types]]
- [[_COMMUNITY_Logo Types|Logo Types]]
- [[_COMMUNITY_Badge Types|Badge Types]]
- [[_COMMUNITY_LiveIndicator Types|LiveIndicator Types]]
- [[_COMMUNITY_PageControl Types|PageControl Types]]
- [[_COMMUNITY_SearchField Types|SearchField Types]]
- [[_COMMUNITY_GlassCard Types|GlassCard Types]]
- [[_COMMUNITY_Avatar Types|Avatar Types]]
- [[_COMMUNITY_DateChip Types|DateChip Types]]
- [[_COMMUNITY_DivisionRing Types|DivisionRing Types]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_Card Types|Card Types]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `Lucide React Icon Library` - 10 edges
3. `Live Bracket Design System` - 8 edges
4. `Badge Prompt` - 7 edges
5. `scripts` - 5 edges
6. `Avatar()` - 4 edges
7. `DateChip()` - 4 edges
8. `Icon()` - 4 edges
9. `SearchField Prompt` - 4 edges
10. `Icon Component` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Live Bracket Logomark SVG - orange circle with white bracket shapes` --semantically_similar_to--> `Live Bracket Logo (full canvas)`  [INFERRED] [semantically similar]
  public/images/livebracket/logomark.svg → Logo LB.svg
- `SearchField Component` --conceptually_related_to--> `Live Bracket Design System`  [INFERRED]
  components/livebracket-ds/forms/SearchField.prompt.md → CLAUDE.md
- `Button Component` --conceptually_related_to--> `Live Bracket Design System`  [INFERRED]
  components/livebracket-ds/buttons/Button.prompt.md → CLAUDE.md
- `Logo Component` --conceptually_related_to--> `Live Bracket Design System`  [INFERRED]
  components/livebracket-ds/brand/Logo.prompt.md → CLAUDE.md
- `Icon Component` --conceptually_related_to--> `Live Bracket Design System`  [INFERRED]
  components/livebracket-ds/icons/Icon.prompt.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **All DS components form the Live Bracket Design System** — ds_button_component, ds_searchfield_component, ds_logo_component, ds_badge_component, ds_icon_component, ds_glasscard_component, ds_matchcard_component [INFERRED 0.95]
- **MatchCard composes Avatar and is part of bracket UI** — ds_matchcard_component, ds_avatar_component, ds_bracket_card [INFERRED 0.85]
- **SearchField and SegmentedControl use Icon and form the Forms group** — ds_searchfield_component, ds_segmentedcontrol_component, ds_icon_component [EXTRACTED 1.00]
- **Live Bracket Logo Assets** — logo_lb, images_livebracket_logomark, concept_brand_identity, concept_tournament_bracket [INFERRED 0.90]
- **Beach Volleyball Tournament Media Assets** — images_activity_social, images_hero, images_activity_league, images_livebracket_beach_volleyball, images_memories_beach_poster, images_livebracket_memories_beach_poster, concept_beach_volleyball_tournament [INFERRED 0.90]
- **Next.js Default Public Folder Assets** — public_vercel, public_next, public_globe, public_window, public_file, concept_nextjs_default_assets [INFERRED 0.85]

## Communities (32 total, 21 thin omitted)

### Community 0 - "Design System Components"
Cohesion: 0.08
Nodes (16): MatchCard(), Logo(), Button(), Avatar(), Badge(), DateChip(), DivisionRing(), LiveIndicator() (+8 more)

### Community 1 - "DS Docs & Agent Instructions"
Cohesion: 0.07
Nodes (30): CLAUDE.md Agent Instructions, Avatar Component, Badge Component, Badge Prompt, Bracket DS Card, Brand DS Card, Button Component, Button Prompt (+22 more)

### Community 2 - "App Pages & Routes"
Cohesion: 0.08
Nodes (17): ACTIVE_TOURNAMENTS, ORGANIZER, PAST_TOURNAMENTS, STATS, Icon Component, Icon Prompt, Icons DS Card, Lucide React Icon Library (+9 more)

### Community 3 - "Package Dependencies"
Cohesion: 0.08
Nodes (23): dependencies, framer-motion, lucide-react, next, react, react-dom, devDependencies, eslint (+15 more)

### Community 4 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 5 - "Homepage Live Scores"
Cohesion: 0.15
Nodes (11): CAROUSEL_MATCHES, CarouselMatch, FILTERS, getAvatarText(), getTeamName(), LiveBracketHome(), RegistrationInfo, Status (+3 more)

### Community 6 - "Tournament Bracket View"
Cohesion: 0.15
Nodes (9): BRACKET, BracketMatch, MatchPlayer, POOL_STANDINGS, SCHEDULE, Tab, TEAMS, TOURNAMENT (+1 more)

### Community 7 - "Brand & Visual Assets"
Cohesion: 0.27
Nodes (11): Beach Volleyball Tournament Context, Live Bracket Brand Identity, Tournament Bracket Visual Concept, Beach Volleyball League Activity Photo - players spiking at net, Beach Volleyball Social Activity Photo - players at net on beach, Hero Image - Beach Volleyball players at net, Beach Volleyball Action Photo - players blocking at net on beach, Live Bracket Logomark SVG - orange circle with white bracket shapes (+3 more)

### Community 8 - "Tournament Creator"
Cohesion: 0.25
Nodes (4): Court, Division, FORMATS, STEPS

### Community 9 - "Next.js Default Assets"
Cohesion: 0.33
Nodes (6): Next.js Default Starter Assets, File/Document Icon SVG, Globe/Web Icon SVG, Next.js Logo SVG, Vercel Logo SVG, Window/Browser Icon SVG

## Knowledge Gaps
- **114 isolated node(s):** `config`, `name`, `version`, `private`, `dev` (+109 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Lucide React Icon Library` connect `App Pages & Routes` to `Tournament Creator`, `Package Dependencies`, `Homepage Live Scores`, `Tournament Bracket View`?**
  _High betweenness centrality (0.322) - this node is a cross-community bridge._
- **Why does `Icon Component` connect `App Pages & Routes` to `DS Docs & Agent Instructions`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `Live Bracket Design System` connect `DS Docs & Agent Instructions` to `App Pages & Routes`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `Live Bracket Design System` (e.g. with `Badge Component` and `Button Component`) actually correct?**
  _`Live Bracket Design System` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `config`, `name`, `version` to the rest of the system?**
  _114 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Design System Components` be split into smaller, more focused modules?**
  _Cohesion score 0.08362369337979095 - nodes in this community are weakly interconnected._
- **Should `DS Docs & Agent Instructions` be split into smaller, more focused modules?**
  _Cohesion score 0.0735632183908046 - nodes in this community are weakly interconnected._