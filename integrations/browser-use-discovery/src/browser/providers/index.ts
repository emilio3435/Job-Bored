import type { AtsSourceId, CompanyTarget } from "../../contracts.ts";
import { buildDetectionHints, dedupeSurfaces } from "./shared.ts";
import { ashbyProvider } from "./ashby.ts";
import { breezyProvider } from "./breezy.ts";
import { greenhouseProvider } from "./greenhouse.ts";
import { icimsProvider } from "./icims.ts";
import { jobviteProvider } from "./jobvite.ts";
import { leverProvider } from "./lever.ts";
import { personioProvider } from "./personio.ts";
import { recruiteeProvider } from "./recruitee.ts";
import { smartrecruitersProvider } from "./smartrecruiters.ts";
import { successFactorsProvider } from "./successfactors.ts";
import { taleoProvider } from "./taleo.ts";
import { teamtailorProvider } from "./teamtailor.ts";
import type {
  AtsProvider,
  AtsProviderRegistry,
  ProviderMemorySnapshot,
} from "./types.ts";
import { workableProvider } from "./workable.ts";
import { workdayProvider } from "./workday.ts";

const DEFAULT_PROVIDER_DETECTION_TIMEOUT_MS = 12_000;

export const BUILTIN_ATS_PROVIDERS: AtsProvider[] = [
  greenhouseProvider,
  leverProvider,
  ashbyProvider,
  smartrecruitersProvider,
  workdayProvider,
  icimsProvider,
  jobviteProvider,
  taleoProvider,
  successFactorsProvider,
  workableProvider,
  breezyProvider,
  recruiteeProvider,
  teamtailorProvider,
  personioProvider,
];

export function createAtsProviderRegistry(
  providers: AtsProvider[] = BUILTIN_ATS_PROVIDERS,
  options: {
    detectionTimeoutMs?: number;
  } = {},
): AtsProviderRegistry {
  const detectionTimeoutMs =
    options.detectionTimeoutMs ?? DEFAULT_PROVIDER_DETECTION_TIMEOUT_MS;
  const providerMap = new Map<AtsSourceId, AtsProvider>(
    providers.map((provider) => [provider.id, provider]),
  );
  return {
    providers,
    getProvider(sourceId) {
      return providerMap.get(sourceId);
    },
    async detectSurfaces(company, effectiveSources, memory) {
      const enabledProviders = effectiveSources
        .map((sourceId) => providerMap.get(sourceId))
        .filter((provider): provider is AtsProvider => !!provider);
      const settled = await Promise.allSettled(
        enabledProviders.map((provider) =>
          withProviderTimeout(
            provider.detectSurfaces(
              company,
              buildDetectionHints(company, provider.id),
              memory,
            ),
            detectionTimeoutMs,
          ),
        ),
      );
      const surfaces = settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      return dedupeSurfaces(surfaces, (surface) => {
        return providerMap.get(surface.sourceId)?.scoreSurface(surface) || 0;
      });
    },
  };
}

function withProviderTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Provider detection timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export {
  ashbyProvider,
  breezyProvider,
  greenhouseProvider,
  icimsProvider,
  jobviteProvider,
  leverProvider,
  personioProvider,
  recruiteeProvider,
  smartrecruitersProvider,
  successFactorsProvider,
  taleoProvider,
  teamtailorProvider,
  workableProvider,
  workdayProvider,
};

export type { ProviderMemorySnapshot };
