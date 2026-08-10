'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';
import { Field, FieldGroup } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { responseError } from '@/lib/api-response';
import { toast } from 'sonner';
import { Loader2, AlertCircle, UserPlus, Pencil } from 'lucide-react';
import { AUTH, AUTH_VALUES, AUTH_LABELS } from '@flyff/entities/constants/authority';
import {
  CreateAccountSchema,
  UpdateAccountSchema,
  fieldErrors,
  USERNAME_MIN,
  USERNAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from '@/lib/account-form';

/** Tier options for the authority select — name + raw ASCII value (rule 12). */
function AuthorityOptions(): React.JSX.Element {
  return (
    <>
      {AUTH_VALUES.map((v) => (
        <option key={v} value={v}>
          {AUTH_LABELS[v]} ({v})
        </option>
      ))}
    </>
  );
}

const AUTHORITY_HINT =
  'General = player. Game Master tiers gate /cmd access; Administrator = all commands + admin panel login.';

interface FormState {
  username: string;
  password: string;
  confirm: string;
  email: string;
  authority: number;
  banned: boolean;
}

const EMPTY: FormState = {
  username: '',
  password: '',
  confirm: '',
  email: '',
  authority: AUTH.GENERAL,
  banned: false,
};

/** Local-datetime input value → ISO-8601 with offset (what the schema wants). */
function toIso(local: string): string {
  if (local.trim() === '') return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

function localFromIso(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Create ────────────────────────────────────────────────────────────────────

/** Trigger button + create-account modal. Rendered by the accounts list page. */
export function CreateAccountButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <UserPlus className="mr-2 h-4 w-4" />
        New account
      </Button>
      {open && (
        <CreateAccountModal
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function CreateAccountModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  const errors: Record<string, string> = {
    ...fieldErrors(CreateAccountSchema, {
      username: form.username,
      password: form.password,
      email: form.email,
      authority: form.authority,
      banned: form.banned,
    }),
    ...(form.confirm !== form.password ? { confirm: 'Passwords do not match' } : {}),
  };
  const errorCount = Object.keys(errors).length;
  const errorFor = (key: string): string | undefined => (touched ? errors[key] : undefined);

  async function save(): Promise<void> {
    setTouched(true);
    if (errorCount > 0) {
      toast.error(`Fix ${String(errorCount)} invalid field${errorCount > 1 ? 's' : ''} first`);
      return;
    }
    setSaving(true);
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username,
        password: form.password,
        email: form.email,
        authority: form.authority,
        banned: form.banned,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(`Account "${form.username}" created`);
      router.refresh();
      onClose();
      return;
    }
    toast.error((await responseError(res)) ?? 'Failed to create account');
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="New account"
      description="Usable by the game client immediately — the password is hashed the same way the login server verifies it. Characters are created in-game."
      footer={
        <>
          <Button onClick={() => { void save(); }} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? 'Creating…' : 'Create account'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {touched && errorCount > 0 && (
            <p
              role="alert"
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-destructive"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorCount} field{errorCount > 1 ? 's' : ''} need attention
            </p>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <FieldGroup title="Credentials">
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            <Field
              htmlFor="acc-username"
              label="Username"
              hint={`${String(USERNAME_MIN)}–${String(USERNAME_MAX)} chars, letters/digits/underscore`}
              error={errorFor('username')}
            >
              <Input
                id="acc-username"
                autoComplete="off"
                maxLength={USERNAME_MAX}
                value={form.username}
                onChange={(e) => {
                  set('username', e.target.value);
                }}
              />
            </Field>
            <Field
              htmlFor="acc-email"
              label="Email"
              hint="Optional — stored for contact only"
              error={errorFor('email')}
            >
              <Input
                id="acc-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => {
                  set('email', e.target.value);
                }}
              />
            </Field>
            <Field
              htmlFor="acc-password"
              label="Password"
              hint={`${String(PASSWORD_MIN)}–${String(PASSWORD_MAX)} chars`}
              error={errorFor('password')}
            >
              <Input
                id="acc-password"
                type="password"
                autoComplete="new-password"
                maxLength={PASSWORD_MAX}
                value={form.password}
                onChange={(e) => {
                  set('password', e.target.value);
                }}
              />
            </Field>
            <Field
              htmlFor="acc-confirm"
              label="Confirm password"
              hint="Must match"
              error={errorFor('confirm')}
            >
              <Input
                id="acc-confirm"
                type="password"
                autoComplete="new-password"
                maxLength={PASSWORD_MAX}
                value={form.confirm}
                onChange={(e) => {
                  set('confirm', e.target.value);
                }}
              />
            </Field>
          </div>
        </FieldGroup>

        <FieldGroup title="Access">
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            <Field htmlFor="acc-authority" label="Authority" hint={AUTHORITY_HINT}>
              <Select
                id="acc-authority"
                value={form.authority}
                onChange={(e) => {
                  set('authority', Number(e.target.value));
                }}
              >
                <AuthorityOptions />
              </Select>
            </Field>
            <Field htmlFor="acc-banned" label="Banned" hint="Blocked from logging in">
              <Switch
                id="acc-banned"
                checked={form.banned}
                onChange={(e) => {
                  set('banned', e.target.checked);
                }}
              />
            </Field>
          </div>
        </FieldGroup>
      </div>
    </Modal>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────────

export interface EditableAccount {
  id: number;
  username: string;
  email: string | null;
  authority: number;
  banned: boolean;
  bannedUntil: string | null;
}

/** Trigger button + edit-account modal. Rendered by the account detail page. */
export function EditAccountButton({ account }: { account: EditableAccount }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Pencil className="mr-2 h-4 w-4" />
        Edit account
      </Button>
      {open && (
        <EditAccountModal
          account={account}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

interface EditState {
  email: string;
  password: string;
  confirm: string;
  authority: number;
  banned: boolean;
  bannedUntil: string;
}

function EditAccountModal({
  account,
  onClose,
}: {
  account: EditableAccount;
  onClose: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const initial: EditState = {
    email: account.email ?? '',
    password: '',
    confirm: '',
    authority: account.authority,
    banned: account.banned,
    bannedUntil: localFromIso(account.bannedUntil),
  };
  const [form, setForm] = useState<EditState>({ ...initial });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof EditState>(key: K, value: EditState[K]): void => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  /** Only changed fields are sent, so an untouched password stays untouched. */
  const patch = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { id: account.id };
    if (form.password !== '') body.password = form.password;
    if (form.email !== initial.email) body.email = form.email;
    if (form.authority !== initial.authority) body.authority = form.authority;
    if (form.banned !== initial.banned) body.banned = form.banned;
    if (form.bannedUntil !== initial.bannedUntil) body.bannedUntil = toIso(form.bannedUntil);
    return body;
  };

  const body = patch();
  const dirty = Object.keys(body).length > 1;
  const errors: Record<string, string> = {
    ...(dirty ? fieldErrors(UpdateAccountSchema, body) : {}),
    ...(form.confirm !== form.password ? { confirm: 'Passwords do not match' } : {}),
  };
  const errorCount = Object.keys(errors).length;
  const errorFor = (key: string): string | undefined => (touched ? errors[key] : undefined);

  async function save(): Promise<void> {
    setTouched(true);
    if (errorCount > 0) {
      toast.error(`Fix ${String(errorCount)} invalid field${errorCount > 1 ? 's' : ''} first`);
      return;
    }
    setSaving(true);
    const res = await fetch('/api/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      toast.success('Account updated');
      router.refresh();
      onClose();
      return;
    }
    toast.error((await responseError(res)) ?? 'Failed to update account');
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Edit ${account.username}`}
      description="The username is the client's login name and cannot be changed. Leave the password blank to keep the current one."
      footer={
        <>
          <Button onClick={() => { void save(); }} disabled={saving || !dirty}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setForm({ ...initial });
              setTouched(false);
            }}
            disabled={saving || !dirty}
          >
            Reset
          </Button>
          {touched && errorCount > 0 && (
            <p
              role="alert"
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-destructive"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorCount} field{errorCount > 1 ? 's' : ''} need attention
            </p>
          )}
          {dirty && errorCount === 0 && (
            <p className="ml-auto text-xs text-muted-foreground">Unsaved changes</p>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <FieldGroup title="Credentials">
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            <Field
              htmlFor="edit-email"
              label="Email"
              hint="Blank clears it"
              error={errorFor('email')}
            >
              <Input
                id="edit-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => {
                  set('email', e.target.value);
                }}
              />
            </Field>
            <Field htmlFor="edit-username" label="Username" hint="Login name — read-only">
              <Input id="edit-username" value={account.username} readOnly disabled />
            </Field>
            <Field
              htmlFor="edit-password"
              label="New password"
              hint={`Blank = unchanged; else ${String(PASSWORD_MIN)}–${String(PASSWORD_MAX)} chars`}
              error={errorFor('password')}
            >
              <Input
                id="edit-password"
                type="password"
                autoComplete="new-password"
                maxLength={PASSWORD_MAX}
                value={form.password}
                onChange={(e) => {
                  set('password', e.target.value);
                }}
              />
            </Field>
            <Field
              htmlFor="edit-confirm"
              label="Confirm new password"
              hint="Must match"
              error={errorFor('confirm')}
            >
              <Input
                id="edit-confirm"
                type="password"
                autoComplete="new-password"
                maxLength={PASSWORD_MAX}
                value={form.confirm}
                onChange={(e) => {
                  set('confirm', e.target.value);
                }}
              />
            </Field>
          </div>
        </FieldGroup>

        <FieldGroup title="Access">
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            <Field htmlFor="edit-authority" label="Authority" hint={AUTHORITY_HINT}>
              <Select
                id="edit-authority"
                value={form.authority}
                onChange={(e) => {
                  set('authority', Number(e.target.value));
                }}
              >
                <AuthorityOptions />
              </Select>
            </Field>
            <Field htmlFor="edit-banned" label="Banned" hint="Blocked from logging in">
              <Switch
                id="edit-banned"
                checked={form.banned}
                onChange={(e) => {
                  set('banned', e.target.checked);
                }}
              />
            </Field>
            <Field
              htmlFor="edit-banned-until"
              label="Ban expires"
              hint="Blank = permanent"
              error={errorFor('bannedUntil')}
            >
              <Input
                id="edit-banned-until"
                type="datetime-local"
                value={form.bannedUntil}
                onChange={(e) => {
                  set('bannedUntil', e.target.value);
                }}
              />
            </Field>
          </div>
        </FieldGroup>
      </div>
    </Modal>
  );
}
