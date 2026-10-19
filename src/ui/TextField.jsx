import { useId } from 'react'
import Icon from './Icon'
import { IconButton } from './Button'

/*
 * `ref` reaches the input rather than this component. React 19 passes it as an
 * ordinary prop, so no forwardRef wrapper is needed, and it is destructured here
 * so it cannot also land in `...rest` and be applied twice. Callers that need to
 * focus or measure the control — the PIN box on sign-in — ask for it here instead
 * of reaching around the field with a DOM query.
 */
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  multiline,
  required,
  error,
  help,
  autoComplete,
  inputMode,
  ref,
  ...rest
}) {
  const id = useId()
  const helpId = help || error ? `${id}-help` : undefined
  const Tag = multiline ? 'textarea' : 'input'

  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="field__control">
        <Tag
          id={id}
          ref={ref}
          className="field__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={multiline ? undefined : type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={helpId}
          required={required}
          {...rest}
        />
      </div>
      {error || help ? (
        <span className="field__help" id={helpId}>
          {error || help}
        </span>
      ) : null}
    </div>
  )
}

export function SelectField({ label, value, onChange, options, required, ...rest }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="field__control">
        <select
          id={id}
          className="field__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="down" size={20} />
      </div>
    </div>
  )
}

export function SearchBar({ value, onChange, placeholder = 'Search', className = '' }) {
  /* Escape and the × are one action, handled here rather than left to the
     browser: a native search input clears on Escape in Firefox and not in
     Safari, and the field has to behave the same on both. */
  const clear = () => onChange('')

  return (
    <div className={`search-bar ${className}`.trim()}>
      <Icon name="search" size={20} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            clear()
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? <IconButton icon="close" className="search-bar__clear" label="Clear search" onClick={clear} /> : null}
    </div>
  )
}