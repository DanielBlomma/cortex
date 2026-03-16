import type { ImpactParams, RelatedParams, SearchParams } from "./types.js";

export type ResponsePreset = "full" | "compact" | "minimal";

type ImpactPresetOptions = {
  includeScores: boolean;
  includeReasons: boolean;
  verbosePaths: boolean;
  maxPathHopsShown: number;
};

type SearchPresetOptions = {
  includeScores: boolean;
  includeMatchedRules: boolean;
  includeContent: boolean;
};

type RelatedPresetOptions = {
  includeEdges: boolean;
  includeEntityMetadata: boolean;
};

function resolvePresetOptions<TDefaults extends Record<string, boolean | number | string>>(
  responsePreset: ResponsePreset | undefined,
  presetDefaultsByMode: Record<ResponsePreset, TDefaults>,
  explicitOverrides: Partial<TDefaults>
): TDefaults & { responsePreset: ResponsePreset } {
  const resolvedPreset = responsePreset ?? "full";
  const presetDefaults = presetDefaultsByMode[resolvedPreset];

  return {
    responsePreset: resolvedPreset,
    ...presetDefaults,
    ...Object.fromEntries(
      Object.entries(explicitOverrides).filter(([, value]) => value !== undefined)
    )
  } as TDefaults & { responsePreset: ResponsePreset };
}

export function resolveImpactResponsePreset(parsed: ImpactParams): {
  responsePreset: ResponsePreset;
  includeScores: boolean;
  includeReasons: boolean;
  verbosePaths: boolean;
  maxPathHopsShown: number;
} {
  return resolvePresetOptions<ImpactPresetOptions>(
    parsed.response_preset,
    {
      full: {
        includeScores: true,
        includeReasons: true,
        verbosePaths: true,
        maxPathHopsShown: 2
      },
      compact: {
        includeScores: false,
        includeReasons: true,
        verbosePaths: false,
        maxPathHopsShown: 2
      },
      minimal: {
        includeScores: false,
        includeReasons: false,
        verbosePaths: false,
        maxPathHopsShown: 1
      }
    },
    {
      includeScores: parsed.include_scores,
      includeReasons: parsed.include_reasons,
      verbosePaths: parsed.verbose_paths,
      maxPathHopsShown: parsed.max_path_hops_shown
    }
  );
}

export function resolveSearchResponsePreset(parsed: SearchParams): {
  responsePreset: ResponsePreset;
  includeScores: boolean;
  includeMatchedRules: boolean;
  includeContent: boolean;
} {
  return resolvePresetOptions<SearchPresetOptions>(
    parsed.response_preset,
    {
      full: {
        includeScores: true,
        includeMatchedRules: true,
        includeContent: false
      },
      compact: {
        includeScores: false,
        includeMatchedRules: true,
        includeContent: false
      },
      minimal: {
        includeScores: false,
        includeMatchedRules: false,
        includeContent: false
      }
    },
    {
      includeScores: parsed.include_scores,
      includeMatchedRules: parsed.include_matched_rules,
      includeContent: parsed.include_content
    }
  );
}

export function resolveRelatedResponsePreset(parsed: RelatedParams): {
  responsePreset: ResponsePreset;
  includeEdges: boolean;
  includeEntityMetadata: boolean;
} {
  return resolvePresetOptions<RelatedPresetOptions>(
    parsed.response_preset,
    {
      full: {
        includeEdges: true,
        includeEntityMetadata: true
      },
      compact: {
        includeEdges: false,
        includeEntityMetadata: true
      },
      minimal: {
        includeEdges: false,
        includeEntityMetadata: false
      }
    },
    {
      includeEdges: parsed.include_edges,
      includeEntityMetadata: parsed.include_entity_metadata
    }
  );
}
