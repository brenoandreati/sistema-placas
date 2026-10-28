"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { loginAction, type LoginState } from "@/server/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <Field label="E-mail">
        {(p) => (
          <Input
            {...p}
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            defaultValue={state.email}
          />
        )}
      </Field>
      <Field label="Senha">
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      {state.error && (
        <p role="alert" className="rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        Entrar
      </Button>
    </form>
  );
}
