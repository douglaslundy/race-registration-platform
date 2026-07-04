"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";

interface AthleteProfileData {
  cpf: string | null;
  birthDate: Date | string | null;
  phone: string | null;
  gender: string | null;
  city: string | null;
  state: string | null;
  teamName: string | null;
  preferredShirtSize: string | null;
}

interface RegistrationContextData {
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
}

interface AthleteDetailsModalProps {
  athleteName: string;
  athleteEmail: string;
  profile: AthleteProfileData | null;
  registrationContext?: RegistrationContextData;
}

export default function AthleteDetailsModal({
  athleteName,
  athleteEmail,
  profile,
  registrationContext,
}: AthleteDetailsModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary-600 hover:underline"
      >
        Ver dados do atleta
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{athleteName}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{athleteEmail}</p>

            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                Perfil do atleta
              </h3>
              {profile ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">CPF</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{profile.cpf ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Nascimento</dt>
                    <dd className="text-gray-800 dark:text-gray-200">
                      {profile.birthDate ? formatDate(profile.birthDate, "dd/MM/yyyy") : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Telefone</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{profile.phone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Gênero</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{profile.gender ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Cidade</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{profile.city ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Estado</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{profile.state ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Equipe</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{profile.teamName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Camiseta preferida</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{profile.preferredShirtSize ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Este atleta ainda não preencheu o perfil.
                </p>
              )}
            </div>

            {registrationContext && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                  Dados desta inscrição
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">Contato de emergência</dt>
                    <dd className="text-gray-800 dark:text-gray-200">
                      {registrationContext.emergencyContactName ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Telefone de emergência</dt>
                    <dd className="text-gray-800 dark:text-gray-200">
                      {registrationContext.emergencyContactPhone ?? "—"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-500">Observações médicas</dt>
                    <dd className="text-gray-800 dark:text-gray-200">
                      {registrationContext.medicalNotes ?? "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
