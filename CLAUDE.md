# CLAUDE.md

## UI: never use native browser dialogs

Never use `alert()`, `confirm()`, or `window.prompt()` anywhere in this app. Always use a modal
component instead.

Two shared components exist for this — reuse them instead of hand-rolling a new modal:

- `components/ui/ConfirmModal.tsx` — replaces `confirm()` (and `prompt()`, via `showNoteField`).
  Props: `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `tone` (`"default" | "danger" |
  "success"`), `loading`, `showNoteField`, `noteRequired`, `notePlaceholder`, `onConfirm(note?)`,
  `onCancel()`.
- `components/ui/ErrorModal.tsx` — replaces `alert()` for error messages. Props: `message: string |
  null`, `onClose()`.

Typical usage in an action button component:

```tsx
const [confirming, setConfirming] = useState(false);
const [error, setError] = useState<string | null>(null);

async function handleAction() {
  const res = await fetch(...);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao ...");
  }
  setConfirming(false);
}

<ConfirmModal open={confirming} title="..." message="..." tone="danger" onConfirm={handleAction} onCancel={() => setConfirming(false)} />
<ErrorModal message={error} onClose={() => setError(null)} />
```

This applies to every new component, and retroactively to any existing component you touch that
still uses a native dialog — fix it as part of the change, don't leave it.
