# Harsh Panchal Portfolio

A lightweight editorial portfolio inspired by the visual language of kokiltamta.in and rebuilt as an original static site for Harsh Panchal.

## Stack

- HTML5
- CSS3
- JSON
- GitHub Pages

No React, npm, build tooling, backend, or database is required.

## Local preview

You can simply open `index.html`, or run:

```bash
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## Deploy to GitHub Pages

Recommended repository name:

```text
HarshPanchal05.github.io
```

Then:

1. Push all files to the `main` branch.
2. Open GitHub repository **Settings**.
3. Open **Pages**.
4. Choose **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. Save.

Your site should be available at:

```text
https://harshpanchal05.github.io/
```

## Resume

Structured resume data is stored in:

```text
resume.json
```

To also offer a PDF resume:

1. Put your PDF in `assets/resume/`.
2. Example filename: `Harsh-Panchal-Resume.pdf`.
3. Change the resume links in `index.html` from `./resume.json` to the PDF path where desired.

## LinkedIn

The site intentionally does not invent a LinkedIn profile URL.

Search `LinkedIn can be added here` inside `index.html` and replace that area with your real LinkedIn link.

## Projects

The Catalogue Generator links directly to its known repository.

For the remaining cards, update their links to exact repository URLs as needed.

## Customization

Primary design variables are at the top of:

```text
css/styles.css
```

You can easily change the warm background, text, spacing, and layout there.
