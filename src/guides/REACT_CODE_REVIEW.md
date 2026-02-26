# React Webapp Code Review Guide

## Linter
Run `npx eslint . --format json` and include any findings in your review.

---

## 1. Component Patterns

- **Functional components only** — no class components in new code.
- **Custom hooks** for reusable stateful logic. Extract when logic is used in 2+ components or when a component exceeds ~100 lines.
- **Single responsibility:** each component does one thing. If a component handles data fetching, state management, and complex rendering, it should be split.
- **Props interface** defined with TypeScript `interface` — not inline `{ prop: type }` in the function signature.
- **Default exports** only for page-level components. Named exports for everything else.
- **No business logic in components.** Components render UI; hooks and utilities handle logic.

---

## 2. State Management

- **`useState`** for simple local state. **`useReducer`** for complex state with multiple sub-values or transitions.
- **Lift state only as high as needed.** Don't put everything in global state.
- **Context** for dependency injection (theme, auth, API client) — not for frequently changing data (causes subtree re-renders).
- **Avoid prop drilling** past 2-3 levels. Use context, composition, or a state library.
- **State shape:** normalize nested data. Avoid deeply nested state objects that are hard to update immutably.

### Red flags
- `useState` for data that should be server state (use React Query / SWR instead)
- Global state for UI-only concerns (modal open, form values)
- Derived state stored separately instead of computed on render

---

## 3. Performance

- **`useMemo`** only for expensive computations. Don't wrap trivial operations.
- **`useCallback`** for functions passed as props to memoized children. Not needed otherwise.
- **`React.memo`** for components that re-render often with the same props. Profile first.
- **Avoid premature optimization.** Measure with React DevTools Profiler before adding memoization.
- **Virtualization** for long lists — use `react-window` or `react-virtuoso` instead of rendering 1000+ items.
- **Code splitting** with `React.lazy` + `Suspense` for routes and heavy components.

---

## 4. Side Effects

- **`useEffect` dependency arrays must be complete.** Missing dependencies cause stale closures. Extra dependencies cause unnecessary re-runs.
- **Cleanup functions** for subscriptions, timers, event listeners, and abort controllers.
- **Race conditions:** use abort controllers or stale flags for async effects.
- **No side effects during render.** Side effects belong in `useEffect`, event handlers, or callbacks.
- **`useEffect` with `[]`** runs once on mount — verify this is intentional.

### Common bugs
```tsx
// Bug: stale closure over `count`
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, []);

// Fix: use functional update
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000);
  return () => clearInterval(id);
}, []);
```

---

## 5. TypeScript

- **No `any` type.** Use `unknown` for truly unknown types, then narrow.
- **Strict mode** must be enabled in `tsconfig.json`.
- **Discriminated unions** for state machines and variant types.
- **Generic components** when the same component works with different data types.
- **Utility types:** `Partial<T>`, `Pick<T, K>`, `Omit<T, K>`, `Record<K, V>` — prefer over manual type construction.
- **Type guards** (`function isFoo(x): x is Foo`) for narrowing union types at runtime.

---

## 6. Styling (Tailwind)

- **Utility classes** for all styling — no inline `style={{ }}` except for dynamic values (transforms, animations with computed values).
- **Responsive design:** use Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`). Mobile-first approach.
- **Dark mode:** support `dark:` variants. Don't hardcode light-mode colors.
- **Consistent spacing:** use Tailwind's spacing scale. Don't mix arbitrary values (`p-[13px]`) with scale values (`p-4`).
- **Extract repeated patterns** into component classes via `@apply` or shared components — not copy-pasted class strings.
- **No `!important`** overrides — fix specificity issues properly.

---

## 7. Accessibility

- **Semantic HTML:** `<button>` for actions, `<a>` for navigation, `<nav>`, `<main>`, `<header>`, etc.
- **ARIA labels** on interactive elements without visible text (icon buttons, inputs without labels).
- **Keyboard navigation:** all interactive elements must be reachable and operable via keyboard.
- **Focus management:** modal/dialog focus trapping, focus restoration on close.
- **Color contrast:** meet WCAG AA standards. Don't rely on color alone to convey information.
- **Alt text** on images. Decorative images use `alt=""`.

---

## 8. Error Handling

- **Error boundaries** for catching render errors. At minimum, wrap routes and major sections.
- **User-facing error messages** for all failure states — not blank screens or console errors.
- **Loading states** for all async operations. Use skeleton UIs over spinners where appropriate.
- **Retry mechanisms** for transient failures (network errors).
- **Form validation** with clear, specific error messages shown inline.

---

## 9. Testing

- **React Testing Library** for component tests — test behavior, not implementation.
- **`userEvent`** over `fireEvent` — more realistic user interaction simulation.
- **Don't test implementation details.** Don't assert on state values or component internals.
- **Test what the user sees:** query by role, label, text — not by test ID unless necessary.
- **Mock at the boundary:** mock API calls (MSW or jest mocks), not internal functions.
- **Coverage:** test happy paths, error states, loading states, and edge cases.

---

## 10. Security

- **No `dangerouslySetInnerHTML`** without sanitization (use DOMPurify).
- **XSS prevention:** React escapes by default, but watch for URL injection (`javascript:` protocol), `href` attributes, and SVG injection.
- **CSRF tokens** on state-mutating requests.
- **No secrets in client-side code.** API keys that must be in the browser should be restricted by domain.
- **Validate redirect URLs** to prevent open redirects.
- **Content Security Policy** headers configured properly.

---

## 11. Bundle Size

- **Dynamic imports** (`React.lazy`) for routes and heavy components.
- **Tree-shaking friendly exports:** use named exports. Avoid barrel files (`index.ts` re-exporting everything) for large modules.
- **Check bundle impact** of new dependencies. Prefer smaller, focused libraries.
- **No duplicate dependencies** — check for multiple versions of the same package.
- **Image optimization:** use `next/image` or similar, serve WebP/AVIF, lazy load below-fold images.

---

## 12. Routing

- **Code splitting at route level** — each route should be a lazy-loaded chunk.
- **Route-level error boundaries** to catch errors without crashing the whole app.
- **Loading states** for lazy-loaded routes (`Suspense` fallback).
- **Protected routes** for authenticated pages — redirect to login, not a blank page.
- **URL state:** use URL search params for filterable/shareable state — not component state.
