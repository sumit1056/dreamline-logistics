# KNOWLEDGE: PWA Architecture & Operational Details

> [!NOTE]
> This document acts as the technical and operational manual for the "Brain" PWA (Progressive Web App) deployment, outlining the service worker strategies, desktop/mobile standalone configurations, and deep-linking capabilities.

---

## 1. PWA Manifest & App Registration
The application uses a standard W3C Web App Manifest located at [manifest.json](file:///e:/logictic_app/public/manifest.json) which defines:
- **Display Mode**: `standalone` to hide browser navigation, offering an immersive, native-app-like experience.
- **Orientation**: Locked to `portrait-primary` to optimize the Notion-style admin and runsheet console grids for mobile displays.
- **Theme Color**: `#5D87FF` for native header styling on mobile OS systems.
- **Dynamic Shortcuts**: Supports quick action launcher deep-links:
  - **Log Transaction**: Links directly to `/?tab=expenses&showAdd=true`
  - **Add Runsheet**: Links directly to `/?tab=orders&showAdd=true`

## 2. Service Worker (`sw.js`) Strategy
The service worker is implemented at [sw.js](file:///e:/logictic_app/public/sw.js) to support offline access and low-signal resilience:
- **Strategy**: **Network-First, Cache-Fallback**. It attempts to fetch live data and routes from the network to ensure real-time consistency.
- **Offline Mode**: If the driver is on the road with poor cellular connectivity, the fetch intercept triggers an automatic fallback to local offline caches, presenting a functional, responsive UI.
- **Asset Caching**: Caches critical UI shell components (`manifest.json`, `favicon.ico`, `logo.png`, and root documents).

## 3. SSR Hydration Mismatch Resolution
A critical hydration warning occurred during the server-to-client handoff:
```
Hydration failed because the server rendered text didn't match the client.
+ May 29
- 29 May
```
### Cause
Dates were formatted using `.toLocaleDateString(undefined, { month: "short", day: "numeric" })`. Passing `undefined` resolved to the **system locale** on the Node/Render server (e.g. `en-GB` formatting as "29 May"), but resolved to the **client browser locale** on the user's mobile device (e.g. `en-US` formatting as "May 29").

### Resolution
Replaced all locale-sensitive date formatting in [home.tsx](file:///e:/logictic_app/app/routes/home.tsx) with a strict, deterministic `en-US` locale string:
```typescript
new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
```
This guarantees identical output on both the server and all client browsers, resolving all hydration exceptions and optimizing React rendering speeds.

---

## 4. Mobile Installation & Shortcut Operation

### 📱 On iOS (Safari)
1. Open the website `https://dreamline-logistics.onrender.com/` in **Safari**.
2. Tap the **Share** button (box with an upward arrow) in the bottom navigation bar.
3. Scroll down and tap **Add to Home Screen**.
4. The PWA will install immediately. You can now tap it to launch in standalone immersive full-screen mode.
5. **Shortcuts**: Touch and hold the app icon on the home screen to show launcher quick links.

### 🤖 On Android (Chrome)
1. Open the website `https://dreamline-logistics.onrender.com/` in **Chrome**.
2. Tap the **Three-Dot Menu** icon at the top right.
3. Tap **Install app** or **Add to Home screen**.
4. Confirm installation. The app will be available in the drawer and home screen.
5. **Shortcuts**: Touch and hold the app icon to view launcher shortcuts for instant transaction/runsheet entries.
