# Default visual system: 编辑部纸张感

Use this visual system whenever the user has not supplied or approved another style. Treat it as a modern editorial system for knowledge communication, not a retro newspaper imitation.

## Visual position

Modern editorial layout × warm-white paper × black ink and restrained vermilion × Song-style headlines × clear information grid.

## Design tokens

| Role | Value | Use |
|---|---|---|
| Warm paper | `#F7F2E8` | Main background |
| Deep paper | `#EEE5D6` | Subtle gradient and section depth |
| Black ink | `#171716` | Headlines, body text, major rules |
| Muted gray | `#6C685F` | Secondary copy and notes |
| Light rule | `#CFC4B3` | Card borders and minor dividers |
| Vermilion | `#F04B16` | Numbers, short labels, key marks, short rule segments |

Use very light paper grain or fibers only when they remain unobtrusive. Never simulate yellowed, torn, stained, or folded old paper.

## Typography

- Set Chinese headlines in `Songti SC`, `STSong`, `Noto Serif CJK SC`, or a comparable modern serif.
- Set Chinese body copy and labels in `PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei`, or a comparable neutral sans serif.
- Set English and numerals in `Georgia` or `Times New Roman` when a serif contrast helps.
- Keep no more than three visible information levels: main title, section title/label, body/note.
- Do not use outlines, glow, extrusion, or material effects on type.

## Layout and components

- Build on strict columns and horizontal baselines. Establish one obvious top-to-bottom reading path.
- Use a masthead with a large serif title, date/version metadata, black rules, and one short vermilion segment.
- Use vermilion two-digit numbers such as `01`, `02`, and `03` as a numbered rail when the source is sequential or sectional.
- Use vermilion outline capsule labels only for short categories; do not place sentences inside pills.
- Use light borders, translucent warm-white fills, near-square corners, and little or no shadow for information blocks.
- Use black/heavier rules for major hierarchy and light beige-gray rules or dotted lines for minor hierarchy.
- Keep a stable safe area. At 1536px width, start around 72–80px and increase it when delivery context needs more breathing room.
- Keep body copy readable in a full-image preview. If content becomes crowded, reduce, regroup, or split it instead of shrinking essential text.

## Default adaptations

- For compact summaries, use one masthead followed by 3–5 numbered sections.
- For processes, keep the numbered rail and add only the minimum arrows or connectors needed to show sequence.
- For comparisons, replace the single content column with aligned two-column blocks while preserving the same rules, tokens, and typographic contrast.
- For long material, split into multiple cards before abandoning readable type sizes.

## Avoid

- Neon gradients, glassmorphism, metallic highlights, or large saturated color fields.
- Heavy shadows, floating cards, oversized rounded corners, cute UI components, icon piles, stickers, or decorative illustration clutter.
- Large vermilion backgrounds. Vermilion is an accent, not a base color.
- Fake vintage distress, folds, oil stains, or broken print effects.
- More than three font families or hierarchy levels competing for attention.
- Image-generated Chinese body copy. Keep all final copy in editable HTML/CSS DOM text.
