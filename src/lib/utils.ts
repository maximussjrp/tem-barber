export function isValidCpf(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 1; i <= 9; i++) sum += parseInt(clean[i - 1]) * (11 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(clean[9])) return false;

  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(clean[i - 1]) * (12 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(clean[10]);
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/--+/g, "-")
    .trim();
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").substring(0, 11);
  if (digits.length > 6) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
  } else if (digits.length > 2) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2)}`;
  }
  return digits;
}

export function formatCep(value: string): string {
  const digits = value.replace(/\D/g, "").substring(0, 8);
  if (digits.length > 5) return `${digits.substring(0, 5)}-${digits.substring(5)}`;
  return digits;
}
