'use client';

import { Copy, KeyRound, Pencil, Plus, ShieldCheck, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useMe, type ScreenInfo } from '@/components/access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText, Field, Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, useAction, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  isAdmin: boolean;
  screens: string[] | null;
  effectiveScreens: string[];
  lastLoginAt: string | null;
}

interface UsersResponse {
  users: UserRow[];
  catalog: ScreenInfo[];
  presets: Record<string, { label: string; screens: string[] }>;
}

/** Senha provisória fácil de ditar: sem letras ambíguas (l, I, 0, O). */
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const lastLogin = (d: string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Nunca entrou';

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      <Copy className="h-3.5 w-3.5" /> {ok ? 'Copiado' : 'Copiar'}
    </Button>
  );
}

function ScreenPicker({
  catalog,
  presets,
  value,
  onChange,
}: {
  catalog: ScreenInfo[];
  presets: UsersResponse['presets'];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const groups = [...new Set(catalog.map((s) => s.group))];
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Modelos:</span>
        {Object.entries(presets).map(([k, p]) => (
          <Button key={k} type="button" variant="outline" size="sm" onClick={() => onChange([...new Set([...value, ...p.screens])])}>
            + {p.label}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
          Limpar
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g} className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g}</p>
            <div className="space-y-1.5">
              {catalog
                .filter((s) => s.group === g)
                .map((s) => (
                  <label key={s.key} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-navy-700" checked={value.includes(s.key)} onChange={() => toggle(s.key)} />
                    {s.label}
                  </label>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserDialog({
  user,
  data,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  data: UsersResponse;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const me = useMe();
  const isSelf = user?.id === me?.user.id;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [admin, setAdmin] = useState(user?.isAdmin ?? false);
  const [active, setActive] = useState(user?.active ?? true);
  const [screens, setScreens] = useState<string[]>(user ? (user.isAdmin ? [] : user.effectiveScreens) : []);
  const [password, setPassword] = useState(() => (user ? '' : tempPassword()));
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const { busy, error, run } = useAction();

  const valid = name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && (admin || screens.length > 0) && (user || password.length >= 8);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
          <DialogDescription>Marque as telas que esta pessoa pode ver. As outras ficam escondidas e bloqueadas.</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Usuário criado. Envie estes dados para a pessoa entrar:</p>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p>
                <span className="text-muted-foreground">E-mail:</span> {created.email}
              </p>
              <p>
                <span className="text-muted-foreground">Senha provisória:</span> <span className="font-mono">{created.password}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <CopyButton text={`Acesso ao CRM da clínica\nE-mail: ${created.email}\nSenha: ${created.password}\n(Troque a senha em "Alterar senha" no menu.)`} />
              <Button onClick={onClose}>Concluir</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Ana (recepção)" />
              </Field>
              <Field label="E-mail de acesso">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ana@exemplo.com" />
              </Field>
              {!user && (
                <Field label="Senha provisória" className="sm:col-span-2">
                  <div className="flex gap-2">
                    <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
                    <Button type="button" variant="outline" onClick={() => setPassword(tempPassword())} title="Gerar outra">
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Field>
              )}
            </div>

            <label className={cn('flex items-start gap-3 rounded-md border p-3', isSelf && 'opacity-60')}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-navy-700" checked={admin} disabled={isSelf} onChange={(e) => setAdmin(e.target.checked)} />
              <span>
                <span className="block text-sm font-medium">Administrador</span>
                <span className="block text-xs text-muted-foreground">Vê todas as telas, inclusive Integrações e Usuários.</span>
              </span>
            </label>

            {!admin && <ScreenPicker catalog={data.catalog} presets={data.presets} value={screens} onChange={setScreens} />}

            {user && !isSelf && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-navy-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Acesso ativo (desmarque para bloquear a entrada)
              </label>
            )}

            <ErrorText>{error}</ErrorText>
            <Button
              disabled={busy || !valid}
              onClick={() =>
                run(async () => {
                  if (user) {
                    await api(`/users/${user.id}`, {
                      method: 'PATCH',
                      body: { name: name.trim(), email: email.trim(), admin, ...(admin ? {} : { screens }), ...(isSelf ? {} : { active }) },
                    });
                    await onSaved();
                    onClose();
                  } else {
                    await api('/users', { method: 'POST', body: { name: name.trim(), email: email.trim(), password, admin, screens: admin ? [] : screens } });
                    await onSaved();
                    setCreated({ email: email.trim().toLowerCase(), password });
                  }
                })
              }
            >
              {user ? 'Salvar alterações' : 'Criar usuário'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [password, setPassword] = useState(tempPassword);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova senha para {user.name}</DialogTitle>
          <DialogDescription>A senha antiga deixa de funcionar na hora.</DialogDescription>
        </DialogHeader>
        <Field label="Nova senha">
          <div className="flex gap-2">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} disabled={done} className="font-mono" />
            {!done && (
              <Button type="button" variant="outline" onClick={() => setPassword(tempPassword())} title="Gerar outra">
                <Wand2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </Field>
        <ErrorText>{error}</ErrorText>
        {done ? (
          <div className="flex gap-2">
            <CopyButton text={`E-mail: ${user.email}\nNova senha: ${password}`} />
            <Button onClick={onClose}>Concluir</Button>
          </div>
        ) : (
          <Button
            disabled={busy || password.length < 8}
            onClick={() =>
              run(async () => {
                await api(`/users/${user.id}/password`, { method: 'POST', body: { password } });
                setDone(true);
              })
            }
          >
            Definir senha
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function UsuariosPage() {
  const { data, error, loading, reload } = useApi<UsersResponse>('/users');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const label = (k: string) => data?.catalog.find((s) => s.key === k)?.label ?? k;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-navy-800">Usuários</h1>
          <p className="text-sm text-muted-foreground">Quem acessa o sistema e quais telas cada pessoa pode ver.</p>
        </div>
        <Button onClick={() => setEditing('new')} disabled={!data}>
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equipe</CardTitle>
          <CardDescription>Mudanças valem na hora: telas retiradas somem do menu e ficam bloqueadas também na API.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && <ErrorText>{error}</ErrorText>}
          {loading && !data && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {data && (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Nome</TH>
                    <TH>Acesso</TH>
                    <TH>Último acesso</TH>
                    <TH className="text-right">Ações</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.users.map((u) => (
                    <TR key={u.id} className={cn(!u.active && 'opacity-60')}>
                      <TD>
                        <p className="font-medium text-navy-800">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </TD>
                      <TD className="max-w-md">
                        <div className="flex flex-wrap gap-1">
                          {!u.active && <Badge variant="outline">Desativado</Badge>}
                          {u.isAdmin ? (
                            <Badge className="gap-1">
                              <ShieldCheck className="h-3 w-3" /> Administrador · todas as telas
                            </Badge>
                          ) : (
                            u.effectiveScreens.map((k) => (
                              <Badge key={k} variant="secondary">
                                {label(k)}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-sm text-muted-foreground">{lastLogin(u.lastLoginAt)}</TD>
                      <TD className="whitespace-nowrap text-right">
                        <Button variant="ghost" size="sm" onClick={() => setResetting(u)} title="Definir nova senha">
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(u)} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && data && (
        <UserDialog user={editing === 'new' ? null : editing} data={data} onClose={() => setEditing(null)} onSaved={reload} />
      )}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}
