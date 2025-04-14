# XFeedSearch Extension

## Overview

XFeedSearch is a browser extension designed for X (formerly Twitter) that clones the native search form and adds a "Search in feed" feature directly below the native search bar. It enables users to search e.g. the last post that they read within their timeline, then read back to the latest post. The extension also ensures that when navigating away from and back to the timeline, the custom search element is reinserted automatically.

## Installation

1. Create a new browser extension project (e.g., for Chrome or Firefox).
2. Add the provided `content.js` file (v2.4) to your extension’s files.
3. In your manifest file, include `content.js` as a content script that runs on `x.com` (or the appropriate URL patterns).
4. Load your extension in developer mode and test its behavior on X.

## Usage

- The native search bar is cloned and a new "Search in feed" element appears directly below it.
- Enter your search query in the new field and click the "Search" button.
  - The button toggles its text between "Search", "Pause", and "Resume" as you use it.
- When a tweet matching the query is found, the extension will smoothly scroll the tweet into view and highlight the matching text.

## 📄 License
This project is licensed under the **GNU General Public License Version 3**. License details available [here](https://www.gnu.org/licenses/gpl-3.0.txt).

