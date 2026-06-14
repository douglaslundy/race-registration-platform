interface OrganizerInfoProps {
  name: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
}

export default function OrganizerInfo({ name, email, phone, companyName }: OrganizerInfoProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Organizador</h2>
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-1 text-sm">
        <p className="font-medium text-gray-900 dark:text-gray-100">{companyName ?? name}</p>
        {companyName && <p className="text-gray-500 dark:text-gray-400">{name}</p>}
        <p className="text-gray-600 dark:text-gray-400">✉️ {email}</p>
        {phone && <p className="text-gray-600 dark:text-gray-400">📞 {phone}</p>}
      </div>
    </div>
  );
}
