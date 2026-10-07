# Portfolio Design System

## Direction

Editorial, restrained, typography-led and intentionally minimal.

## Colors

- Background: `#f1efe8`
- Surface: `#e7e3d8`
- Secondary surface: `#ded9cd`
- Primary text: `#11110f`
- Muted text: `#6b6962`
- Border: `rgba(17, 17, 15, 0.18)`

## Layout

- Max content width: `1500px`
- Responsive page padding using `clamp()`
- CSS Grid and Flexbox only

## Typography

System sans-serif stack:

```css
Arial, Helvetica, sans-serif
```

Hero typography uses `clamp()` for responsive scaling.

## Motion

Transitions are intentionally subtle and respect:

```css
@media (prefers-reduced-motion: reduce)
```

## Responsive checkpoints

The CSS is designed to adapt continuously, with major layout changes around:

- 980px
- 700px
- 430px

It should remain usable from 320px through large desktop displays.
