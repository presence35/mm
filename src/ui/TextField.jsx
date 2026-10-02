import { useId } from 'react'
import Icon from './Icon'

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

export function SearchBar({ value, onChange, placeholder = 'Search' }) {
  return (
    <div className="search-bar">
      <Icon name="search" size={20} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  )
}