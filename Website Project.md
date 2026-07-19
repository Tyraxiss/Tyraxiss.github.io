Act as an expert frontend developer. I want to build a responsive, modern, Spotify-like music player website to showcase my 5 personal music albums. This website will be hosted on GitHub Pages, so it must be completely static (HTML, CSS, and modern vanilla JavaScript, or a single-page React app using Vite that compiles to static files). 

### Project Overview
- **Albums:** 5 distinct albums, each containing 11 to 12 songs.
- **Assets:** Each album has its own folder containing an album cover image (`cover.jpg`) and audio files (`track1.mp3`, etc.).
- **Key Features:** Audio playback, album browsing, tracklists, interactive song lyrics display (with support for timestamped/synchronized lyrics or static text scrolls), and responsive design.

### Tech Stack & Design Constraints
- Use vanilla HTML5, Tailwind CSS (via CDN for simplicity, or a clean modern CSS setup), and modular JavaScript. Keep dependencies minimal so it loads instantly on GitHub Pages.
- **UI Aesthetic:** Dark mode by default, heavily inspired by Spotify. Clean grid layouts for albums, a sidebar for navigation, a main content area for the current album view/lyrics, and a persistent bottom media player bar.

### Core Architecture & File Structure
Please generate the initial boilerplate and structure following this template:
- `/index.html` (Main entry point)
- `/css/style.css` (Custom styles/animations)
- `/js/app.js` (Core player logic, state management, and UI rendering)
- `/js/data.js` (The centralized data file containing the album array, tracklists, and lyric strings)
- `/assets/` (Placeholder directory structure for `album1/cover.jpg`, etc.)

### Specific Feature Requirements
1. **The Sidebar:** Navigation for "Home" and a list of the 5 Albums for quick access.
2. **Main View (Dynamic):** 
   - *Home State:* Displays a beautiful grid of the 5 albums with their cover art and titles. Clicking an album loads the Album View.
   - *Album View:* Displays the large album art, title, release details, and a clean table/list of the 11-12 tracks showing track number, title, and duration.
3. **The Bottom Media Player:**
   - Persistent across views.
   - Left side: Currently playing song title and mini album art.
   - Center: Play/pause button, skip next/previous, shuffle, repeat, and a working progress bar/timeline scrub.
   - Right side: Volume control and a toggle button to open the "Lyrics View".
4. **Lyrics View:** 
   - A dedicated overlay or side panel that displays the lyrics for the currently playing track. 
   - Format the UI so lyrics are large, readable, and vertically centered. If a track has timestamped lyrics, highlight the current line based on the audio player's current time.

### Step 1 Execution
Please generate the `index.html`, `js/data.js` (with a sample mock structure for 2 albums so I can see how to fill in the rest of my 5 albums/12 tracks later), and the core `js/app.js` functionality to get the player UI rendering and playing audio.