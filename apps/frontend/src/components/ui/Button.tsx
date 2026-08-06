import type { ButtonHTMLAttributes } from 'react';
import s from './ui.module.css';
import { Spinner } from './Spinner';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
  block?: boolean;
  loading?: boolean;
}

const variantClass: Record<Variant, string> = {
  default: '',
  primary: s.primary,
  danger: s.danger,
  ghost: s.ghost,
};

export function Button({
  variant = 'default',
  small,
  block,
  loading,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const cls = [s.btn, variantClass[variant], small ? s.small : '', block ? s.block : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={disabled || loading} type={type} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}
