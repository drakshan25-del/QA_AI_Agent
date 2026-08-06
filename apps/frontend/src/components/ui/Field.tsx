import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import s from './ui.module.css';

interface FieldWrapProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
}

function FieldWrap({ label, hint, error, children }: FieldWrapProps): JSX.Element {
  const id = useId();
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && !error && <span className={s.hint}>{hint}</span>}
      {error && (
        <span className={s.fieldError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};
export function TextInput({ label, hint, error, ...rest }: InputProps): JSX.Element {
  return (
    <FieldWrap label={label} hint={hint} error={error}>
      {(id) => <input id={id} className={s.control} {...rest} />}
    </FieldWrap>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
};
export function TextArea({ label, hint, error, ...rest }: TextareaProps): JSX.Element {
  return (
    <FieldWrap label={label} hint={hint} error={error}>
      {(id) => <textarea id={id} className={s.control} {...rest} />}
    </FieldWrap>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};
export function Select({ label, hint, error, children, ...rest }: SelectProps): JSX.Element {
  return (
    <FieldWrap label={label} hint={hint} error={error}>
      {(id) => (
        <select id={id} className={s.control} {...rest}>
          {children}
        </select>
      )}
    </FieldWrap>
  );
}
