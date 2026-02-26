# Android / Kotlin / Jetpack Compose Code Review Guide

## Linter
Run `./gradlew detekt` and include any findings in your review.

---

## 1. Compose State Management

- **`remember`** for in-composition state that survives recomposition but not configuration changes.
- **`rememberSaveable`** for state that must survive configuration changes (screen rotation, process death).
- **State hoisting:** composables should receive state and event callbacks as parameters. Only screen-level composables should hold state.
- **`derivedStateOf`** for values computed from other state — avoids unnecessary recompositions.
- **`mutableStateOf`** should be wrapped in `remember` — creating it without `remember` causes state loss on recomposition.

### Red flags
- State held in a composable that should be in a ViewModel
- `mutableStateOf` without `remember`
- Passing ViewModel directly to child composables instead of hoisting state

---

## 2. Recomposition Performance

- **Stable types:** Compose skips recomposition for stable, unchanged parameters. Classes must be data classes or annotated `@Stable`/`@Immutable`.
- **Lambda stability:** Avoid creating new lambda instances on every recomposition. Use `remember` for callbacks or method references.
- **`key()` for lists:** When using `LazyColumn`/`LazyRow`, always provide a stable `key` parameter to items.
- **Avoid reading state in parent if only child needs it.** Push state reads down to minimize recomposition scope.
- **No heavy computation in composable functions.** Move to ViewModel or use `remember` with keys.

---

## 3. Side Effects

- **`LaunchedEffect(key)`** — for coroutines tied to composition. Cancels and relaunches when key changes.
- **`DisposableEffect(key)`** — for cleanup-required resources (listeners, observers). Must return `onDispose {}`.
- **`SideEffect`** — for non-suspending side effects that must run after every successful recomposition.
- **Never launch coroutines in composable scope** without `LaunchedEffect` or `rememberCoroutineScope`.
- **Effect keys must be correct.** `LaunchedEffect(Unit)` runs once; `LaunchedEffect(id)` re-runs when `id` changes. Wrong keys cause missed updates or infinite loops.

---

## 4. ViewModel Patterns

- **Expose UI state via `StateFlow`** — not `LiveData` in new code.
- **Use `SharedFlow` for one-shot events** (navigation, snackbars) — not channels.
- **No Android framework references in ViewModel** (`Context`, `Activity`, `View`). Use `AndroidViewModel` only if `Application` context is strictly needed.
- **Single source of truth:** ViewModel owns the state. UI observes and sends events.
- **`viewModelScope`** for all ViewModel coroutines — ensures proper cancellation.

---

## 5. Coroutines

- **Use `viewModelScope`** in ViewModels — never `GlobalScope.launch`.
- **Structured concurrency:** child coroutines must be scoped to a parent. Unscoped coroutines leak.
- **Proper dispatchers:** `Dispatchers.IO` for disk/network, `Dispatchers.Default` for CPU-heavy. Never block `Dispatchers.Main`.
- **Handle cancellation:** `CancellationException` should not be caught and swallowed.
- **`withContext`** for dispatcher switching inside a coroutine — not nested `launch` calls.

---

## 6. Navigation

- **Type-safe navigation arguments** — avoid raw string route building.
- **No hardcoded route strings** scattered across composables. Define routes as constants or sealed classes.
- **Deep link handling** must validate input parameters.
- **Back stack management:** check that `popBackStack` and `navigate` with `launchSingleTop` are used correctly.

---

## 7. Dependency Injection

- **Hilt/Dagger** for DI. Check proper scoping (`@Singleton`, `@ViewModelScoped`, `@ActivityScoped`).
- **`@Inject constructor`** for classes that need injection — not manual instantiation.
- **No service locator pattern** — don't access DI container directly from composables.
- **Modules are correctly scoped** and don't provide wider-scoped instances than needed.

---

## 8. Memory Management

- **No `Activity`/`Fragment` context leaks** in long-lived objects. Use `applicationContext` when needed.
- **Coroutine cancellation:** flows collected in UI must use `repeatOnLifecycle` or `collectAsStateWithLifecycle`.
- **Observer cleanup:** `DisposableEffect` must clean up listeners/callbacks in `onDispose`.
- **Bitmap/resource handling:** large resources should be recycled or use proper caching.

---

## 9. Error Handling

- **Sealed `Result` types** for operation outcomes — not raw exceptions for expected failures.
- **User-facing error messages** for all network/IO failures. Silent failures are bugs.
- **`runCatching`** should re-throw `CancellationException` — not swallow it.
- **Retry logic** should have backoff and a maximum attempt count.

---

## 10. Testing

- **JUnit5** for unit tests.
- **MockK** for mocking dependencies.
- **Turbine** for testing `Flow` emissions.
- **Compose UI tests** using `createComposeRule` for testing composables.
- **ViewModel tests** should verify state transitions and event handling.
- **Test edge cases:** empty lists, error states, loading states, configuration changes.

---

## 11. Security

- **No secrets in source code.** API keys use BuildConfig fields or encrypted preferences.
- **ProGuard/R8** enabled for release builds with proper keep rules.
- **Certificate pinning** for sensitive API calls.
- **Input validation** on all user-provided data before sending to APIs.
- **No logging of sensitive data** in release builds. Use `BuildConfig.DEBUG` guards.
- **`android:exported`** explicitly set on all components in AndroidManifest.xml.

---

## 12. Kotlin Style

- **`val` over `var`** — immutability by default.
- **Data classes** for DTOs and state objects.
- **Sealed classes/interfaces** for representing finite state sets.
- **Extension functions** for utility operations on types — not static utility classes.
- **Null safety:** avoid `!!`. Use `?.`, `?:`, `let`, or `requireNotNull` with a message.
- **`when` expressions** should be exhaustive (use `else` or cover all sealed subclasses).
