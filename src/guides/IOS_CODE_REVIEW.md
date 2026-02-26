# iOS / SwiftUI Code Review Guide

## Linter
Run `swiftlint lint --reporter json --quiet` and include any violations in your review.

---

## 1. State Management

Verify correct property wrapper usage:

- **`@State`** — only for local, view-owned value types. If shared across views or is a reference type, it's wrong.
- **`@Binding`** — pass writable state down from a parent. Never created independently.
- **`@Environment(\.modelContext)`** — for SwiftData writes, not passed around manually.
- **`@Query`** — for SwiftData reads in views. Check sort descriptors and predicates. Avoid over-fetching.
- **`@FocusState`** — only for keyboard/focus management, not general-purpose state.
- **No duplicate sources of truth.** If the same data lives in `@State` and `@Query`, one is wrong.

### Red flags
- `@State` on a reference type (class) — should be `@StateObject` or refactored
- `@ObservedObject` where the view owns the object — should be `@StateObject`
- State mutations inside `body` (outside closures/actions) — causes infinite re-render loops

---

## 2. View Complexity

- Views should be **~100 lines or fewer**. If `body` exceeds this, request extraction into child views.
- **Nesting depth** > 3-4 levels usually means a subview should be extracted.
- **Repeated patterns** appearing 2+ times should be reusable components in `Views/Shared/`.
- **Long modifier chains** (10+) suggest the view handles too many concerns.

---

## 3. Performance

SwiftUI re-evaluates `body` on every state change.

- **Isolate state to the smallest possible view.** Push `@State` down to avoid re-evaluating entire subtrees.
- **Use `LazyVStack` / `LazyHStack`** for scrollable lists — not `VStack` inside `ScrollView` with many items.
- **No expensive work in `body`.** Filtering, sorting, date formatting should be in computed properties or cached.
- **Check `@Query` filters.** Unfiltered `@Query` that filters in computed properties is wasteful — use predicates.
- **Watch `onChange` / `onAppear`** that trigger state changes leading to cascading re-renders.

---

## 4. SwiftData

- **Models use `@Model` macro** with appropriate `@Attribute` annotations (e.g., `.unique` for IDs).
- **All relationships must be optional.** SwiftData is unreliable with non-optional relationships.
- **No model subclassing.** SwiftData does not support class inheritance on `@Model` types.
- **Predicates must be simple.** Complex `#Predicate` with local variables or multi-branch logic can crash.
- **Concurrency:** `ModelContext` is not `Sendable`. Use `@ModelActor` for background work. Only `PersistentIdentifier` and `ModelContainer` cross actor boundaries safely.
- **Initializers are required** even if all properties have defaults.
- **Deletions must handle relationships.** Verify cascade rules or manual cleanup.

---

## 5. Navigation and Sheets

- **`NavigationStack`** only — never `NavigationView` (deprecated).
- **Sheet state resets properly** on dismiss. `item`-based sheets use `Identifiable` types.
- **No nested `NavigationStack`s.** A sheet with its own `NavigationStack` is fine, but `NavigationStack` inside another is a bug.
- **`onDismiss` cleans up state** so sheets don't reappear unexpectedly.
- **`.interactiveDismissDisabled()`** on sheets with unsaved data (entry forms).

---

## 6. Theme and Styling

- **Colors:** `Color.<name>` from `Color+Theme.swift` — no raw hex/RGB inline.
- **Fonts:** `Font.<name>` from `Font+Theme.swift` — no `.font(.system(size: 14))`.
- **Spacing:** `CGFloat.<name>` from `Spacing+Theme.swift` — no magic numbers for padding.
- **`.modify {}`** view extension for conditional modifiers instead of ternary or `if/else` in `body`.

### Common violations
- `Color(.systemGray)` instead of a named theme color
- `.padding(16)` instead of `.padding(.paddingMedium)`
- `.font(.headline)` instead of project's `Font.headlineRegular`

---

## 7. iOS Version Compatibility

- **iOS 26+ API calls must be wrapped** in `#available(iOS 26.0, *)` with a fallback.
- **Use `.modify {}`** for availability-gated view modifiers (e.g., `.glassEffect` with `.ultraThinMaterial` fallback).
- **No deprecated APIs:** `NavigationView`, `UIViewRepresentable` when SwiftUI equivalent exists, single-parameter `onChange(of:perform:)`.

---

## 8. Swift Style

- **`async/await`** for all async operations — no completion handlers or `DispatchQueue`.
- **`guard`** for early exits — not deeply nested `if let` chains.
- **Value types (structs)** preferred over classes (SwiftData models are the exception).
- **Max line width: 120 characters.**
- **No force unwraps (`!`)** without justification. Acceptable for: compile-time string literal URLs, Calendar operations with controlled inputs.

---

## 9. Memory Management

- **`[weak self]` in escaping closures** that capture `self` (network callbacks, timers, Combine subscribers).
- **`unowned` only when lifetime is guaranteed** to outlast the closure. When in doubt, use `weak`.
- **Combine subscriptions stored** in `Set<AnyCancellable>` or cancelled explicitly.
- **Timers invalidated** in cleanup (`onDisappear` or `deinit`).
- **Check closures on `sheet`, `onChange`, `task`, `onAppear`** for strong reference cycles.

---

## 10. Networking

- **New API calls added to `APIClient` protocol first**, then implemented in both Live and Mock.
- **Response status codes checked.** Discarding response without checking HTTP errors is a bug.
- **Request/response types in `Networking/DTOs/`** — not inline in views or services.
- **Error handling must be user-facing.** Network calls surface failures to the UI.
- **No hardcoded URLs** in views or services — they belong in the API client.

---

## 11. Security

- **No secrets in source code.** API keys, tokens, credentials use Keychain or env config.
- **Validate external input.** Data from APIs, text fields, deep links validated before use.
- **HTTPS exclusively.** No `http://` URLs in production code.
- **Check Info.plist.** No sensitive config exposed. `NSAppTransportSecurity` exceptions justified.
- **No logging of sensitive data.** `print()` and `os_log` never include tokens, passwords, or PII.

---

## 12. Testing

- **New ViewModels and Services require unit tests** using Swift Testing (`@Test`, `#expect`).
- **Use `MockAPIClient`** for tests involving networking — never hit real endpoints.
- **Test edge cases:** empty states, maximum values, invalid input, date boundaries.
- **SwiftData tests use in-memory container** to avoid polluting on-disk store.
