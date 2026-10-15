# App store checklist (Apple App Store and Google Play)

Already in Bowron:
- [x] Privacy policy and terms pages (`/legal/privacy`, `/legal/terms`), linked from sign-in
- [x] Delete my account inside the app (Account › Delete my account) — required by both stores
- [x] Sign-in without passwords (email code); no account creation in the app (invite-only, business tool)
- [x] Permission prompts only when used: camera (scan / photos), microphone (voice, meeting recording),
      notifications (opt-in on Account), location (map, optional)
- [x] No tracking or ads; no third-party analytics
- [x] Works offline read-only, with a clear banner
- [x] Dark mode, large touch targets (48 px), screen-reader labels

To do with your accounts:
- [ ] App IDs `com.<your-domain>.supplyline` (iOS / Android) and matching names
- [ ] Icons and screenshots (phone + tablet) — take them from the staging app with demo data
- [ ] Apple “App Privacy” answers: Contact info (email, name, phone) and User content (photos,
      audio, documents) — collected, linked to the user, used for App Functionality only; no tracking
- [ ] Google “Data safety” form: same answers; data encrypted in transit; users can request deletion
- [ ] Apple review notes: give a demo organization login (an email + how the reviewer gets the
      code, e.g. a demo address whose codes you forward) because sign-in is invite-only
- [ ] Usage descriptions in the iOS project (Info.plist): NSCameraUsageDescription,
      NSMicrophoneUsageDescription, NSPhotoLibraryAddUsageDescription, NSLocationWhenInUseUsageDescription
- [ ] Export compliance: uses standard HTTPS encryption only (exempt)
- [ ] Support URL and marketing URL (your website)
