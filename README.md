# Minecraft Mods Localizer

Language: English | [繁體中文](README.zh-TW.md)

Minecraft Mods Localizer is a browser-based tool for translating Minecraft mod language files. It reads the `assets/<namespace>/lang/*.json` files inside mod jars and resource packs, shows every detected translation key in an editable workspace, and exports the finished work as a resource pack or patched jar copies.

Use the hosted app here:

https://mc-localizer.triturbo.dev

This is a static web app. It is built with Vite and React, runs in the browser, and does not require a backend server for normal use.

## Why This Exists

Minecraft mods often ship with incomplete, inconsistent, or missing translations. Translating them by hand usually means unpacking jars, comparing locale JSON files, tracking fallback values manually, and rebuilding packs without accidentally damaging the original files.

Minecraft Mods Localizer turns that process into a review workflow:

- Load one or more mod `.jar` files.
- Optionally load existing resource packs as translation sources.
- Choose the Minecraft locales you want to produce.
- Compare source, fallback, vanilla, manual, converted, and LLM-generated values.
- Edit individual keys directly in the browser.
- Save your work as a reusable project patch.
- Export a resource pack zip or patched jar copies when you are done.

The original mod jars are not modified.

## Key Features

- **Jar and resource-pack scanning**: Reads Minecraft language JSON files from local jars and resource packs.
- **Namespace-based review**: Groups entries by namespace so each mod can be reviewed separately.
- **Locale fallback chains**: Uses configurable fallback/source locale priority when a target locale is missing.
- **Bundled vanilla references**: Includes Minecraft locale files under the `minecraft` namespace as read-only reference data.
- **Manual patching**: Lets you override individual translation values and save them in a project patch file.
- **Project restore**: Browser draft storage can restore in-progress work locally.
- **Glossary hints**: Shows matched terminology in the editor and uses those hints to guide LLM translation and OpenCC Chinese conversion.
- **Chinese locale conversion with OpenCC**: Uses `opencc-js` to convert between Simplified Chinese, Taiwan Traditional Chinese, and Hong Kong Traditional Chinese.
- **Optional LLM translation**: Can call an OpenAI-compatible chat-completions endpoint from the browser.
- **Export options**: Generates a normal resource pack zip or patched jar copies without changing the originals.

## Privacy And API Key Disclaimer

This project is designed to be local-first.

- Selected mod jars and resource packs are read by your browser.
- Project patches, resource packs, and patched jar copies are generated in your browser and downloaded locally.
- The hosted static app does not upload your files to a server for scanning, editing, or exporting.
- If you use the optional LLM translation feature, the selected source strings are sent directly from your browser to the API endpoint you configure.
- We do not collect, store, or log your API key.
- The API key is used only in your browser for requests to the configured OpenAI-compatible endpoint.
- The API key is not written to exported project patch files.
- Your LLM provider may receive request data according to that provider's own terms and logging policies.

Only enter an API key on a deployment you trust. If you prefer full control over the served application, clone this repository and deploy your own copy.

## Hosted App

The public deployment is available at:

[https://mc-localizer.triturbo.dev](https://mc-localizer.triturbo.dev)

Because the app is static, the hosted version is just the built frontend files served from a web host. There is no application backend required for the translation editor itself.

## Self-Hosting

You can clone the repository, build the static files, and deploy them to any static hosting provider.

```bash
git clone https://github.com/Tr1turbo/Minecraft-Mods-Localizer.git
cd Minecraft-Mods-Localizer
npm install
npm run build
```

The production site is written to `dist/`.

The Vite build uses relative asset paths, so `dist/` can be hosted from a domain root or a project subpath. Typical targets include Cloudflare Pages, GitHub Pages, Netlify, Vercel static output, S3-compatible object storage, or a simple static file server.

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Run tests with:

```bash
npm test
```

## How It Works

The app uses browser file APIs to read local files selected by the user. Mod jars and resource packs are inspected for Minecraft language files under paths like:

```text
assets/<namespace>/lang/en_us.json
assets/<namespace>/lang/zh_tw.json
assets/<namespace>/lang/ja_jp.json
```

Detected entries are merged into a catalog. For each target locale, the app decides whether the final value comes from an existing jar value, an imported resource pack, a configured fallback locale, a Chinese conversion result, an LLM candidate, or a manual patch.

### Glossary Hints

When a key or source value matches known Minecraft terminology, the editor shows glossary hints beside the selected entry. These hints help manual review, are included in LLM translation prompts, and are also used as a custom dictionary for Chinese conversion where possible.

### Chinese Conversion

Chinese locale conversion is powered by [`opencc-js`](https://github.com/nk2028/opencc-js). When the app has a Chinese source value and the target locale is another supported Chinese variant, it can generate a converted value automatically.

Supported conversion targets:

- `zh_cn`: Simplified Chinese, using OpenCC `cn`
- `zh_tw`: Taiwan Traditional Chinese, using OpenCC `twp`
- `zh_hk`: Hong Kong Traditional Chinese, using OpenCC `hk`

For example, if a mod already has `zh_cn` strings and you are building `zh_tw`, the app can convert the source text with OpenCC and label the result as `Converted`. The conversion also uses the app glossary as a custom OpenCC dictionary where possible, so Minecraft and mod terminology can stay consistent across Chinese locales.

Exports are generated from that catalog:

- **Resource pack export** creates a zip containing translated `assets/<namespace>/lang/*.json` files.
- **Patched jar export** creates downloadable jar copies with patched locale files.
- **Project patch export** saves your manual edits, LLM candidates, glossary overrides, and settings so the work can be resumed later.

## Deployment Configuration

Runtime defaults are loaded from `app-config.json` next to the deployed `index.html`. Vite copies the tracked default from `public/app-config.json` into `dist/` during build.

`app-config.json` is public, so do not put API keys in it.

Example:

```json
{
  "schemaVersion": 1,
  "openai_api": {
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-5.4-mini"
  },
  "app": {
    "packFormat": 34,
    "description": "Generated by Minecraft Mods Localizer",
    "llmBatchSize": 40,
    "llmConcurrency": 3,
    "llmReferenceMode": "en_us"
  }
}
```

Deployment config seeds first-run defaults only. After a user changes settings in the app, the browser draft takes precedence.

## Project Layout

```text
.
├── data/
│   └── curatedGlossary.json
├── minecraft/
│   └── lang/
├── public/
│   ├── app-config.json
│   └── assets/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   └── lib/
├── test/
├── index.html
├── package.json
└── vite.config.ts
```

- `src/lib/` contains framework-independent domain logic for scanning, patching, exporting, locale handling, glossary matching, LLM calls, and deployment config.
- `src/features/` contains page and workflow UI.
- `src/components/` contains shared React UI components.
- `data/curatedGlossary.json` contains the built-in glossary.
- `minecraft/lang/` contains third-party Minecraft locale files used as read-only reference data.
- `test/` contains Vitest unit tests.

## Third-Party Notices

Project-owned code and documentation are MIT licensed. Copyright (c) 2026 Triturbo.

Minecraft locale files under `minecraft/lang/` are third-party reference data and are not covered by this project's MIT license. Minecraft and related assets are owned by Mojang and Microsoft and are subject to their own terms. See `THIRD_PARTY_NOTICES.md` and `minecraft/README.md`.
