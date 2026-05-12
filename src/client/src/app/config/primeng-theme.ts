import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

export interface BrandScale {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950: string;
}

export const TEAL_SCALE: BrandScale = {
  50: '#f0fdfa',
  100: '#ccfbf1',
  200: '#99f6e4',
  300: '#5eead4',
  400: '#2dd4bf',
  500: '#14b8a6',
  600: '#0d9488',
  700: '#0f766e',
  800: '#115e59',
  900: '#134e4a',
  950: '#042f2e',
};

export function buildBrandPreset(scale: BrandScale = TEAL_SCALE) {
  return definePreset(Aura, {
    semantic: {
      primary: scale,
      formField: {
        paddingX: '0.625rem',
        paddingY: '0.5rem',
        borderRadius: '0',
        focusRing: {
          width: '0',
          style: 'none',
          color: 'transparent',
          offset: '0',
          shadow: '0 0 0 2px rgba(13, 148, 136, 0.15)',
        },
      },
      colorScheme: {
        light: {
          surface: {
            0: '#ffffff',
            50: '{slate.50}',
            100: '{slate.100}',
            200: '{slate.200}',
            300: '{slate.300}',
            400: '{slate.400}',
            500: '{slate.500}',
            600: '{slate.600}',
            700: '{slate.700}',
            800: '{slate.800}',
            900: '{slate.900}',
            950: '{slate.950}',
          },
          formField: {
            background: '#ffffff',
            borderColor: '{slate.300}',
            hoverBorderColor: '{slate.500}',
            focusBorderColor: '{primary.600}',
            invalidBorderColor: '{red.500}',
            color: '{slate.900}',
            placeholderColor: '{slate.400}',
            shadow: 'none',
          },
          overlay: {
            select: {
              borderColor: '{slate.200}',
            },
            modal: {
              borderColor: '{slate.200}',
            },
          },
          list: {
            option: {
              focusBackground: '{primary.50}',
              selectedBackground: '{primary.50}',
              selectedFocusBackground: '{primary.50}',
              selectedColor: '{primary.700}',
              selectedFocusColor: '{primary.700}',
            },
          },
        },
      },
    },
    components: {
      dialog: {
        root: {
          borderRadius: '0',
          shadow: '0 10px 24px -12px rgba(15, 23, 42, 0.18)',
        },
        header: {
          padding: '0.75rem 1.25rem',
        },
        title: {
          fontSize: '11px',
          fontWeight: '600',
        },
        content: {
          padding: '1.25rem 1.25rem 1.5rem 1.25rem',
        },
        footer: {
          padding: '0.75rem 1.25rem',
        },
      },
      button: {
        root: {
          borderRadius: '0',
        },
        colorScheme: {
          light: {
            root: {
              primary: {
                background: '{primary.600}',
                hoverBackground: '{primary.700}',
                activeBackground: '{primary.800}',
                borderColor: '{primary.600}',
                hoverBorderColor: '{primary.700}',
                activeBorderColor: '{primary.800}',
                color: '#ffffff',
                hoverColor: '#ffffff',
                activeColor: '#ffffff',
              },
              secondary: {
                borderColor: '{slate.300}',
                hoverBackground: '{slate.50}',
                activeBackground: '{slate.100}',
                color: '{slate.700}',
              },
            },
            outlined: {
              primary: {
                hoverBackground: '{primary.50}',
                activeBackground: '{primary.100}',
                borderColor: '{primary.200}',
                color: '{primary.700}',
              },
              secondary: {
                hoverBackground: '{slate.50}',
                activeBackground: '{slate.100}',
                borderColor: '{slate.300}',
                color: '{slate.700}',
              },
            },
            text: {
              primary: {
                hoverBackground: '{primary.50}',
                activeBackground: '{primary.100}',
                color: '{primary.600}',
              },
            },
          },
        },
      },
      select: {
        root: {
          borderRadius: '0',
        },
        overlay: {
          shadow: '0 10px 24px -12px rgba(15, 23, 42, 0.18)',
        },
        dropdown: {
          width: '2rem',
          color: '{slate.400}',
        },
        option: {
          padding: '0.375rem 0.625rem',
          borderRadius: '0',
        },
      },
      multiselect: {
        root: {
          borderRadius: '0',
        },
        dropdown: {
          width: '2rem',
          color: '{slate.400}',
        },
        option: {
          padding: '0.375rem 0.625rem',
          borderRadius: '0',
        },
      },
      tabs: {
        tablist: {
          background: 'transparent',
        },
        tab: {
          color: '{slate.500}',
          hoverColor: '{slate.900}',
          activeColor: '{slate.900}',
          activeBorderColor: '{primary.600}',
          padding: '0.625rem 0.875rem',
          fontWeight: '500',
        },
        tabpanel: {
          background: 'transparent',
          padding: '1rem 0 0',
        },
        activeBar: {
          background: '{primary.600}',
        },
      },
      datatable: {
        headerCell: {
          background: '{slate.50}',
          color: '{slate.500}',
        },
      },
      toast: {
        root: {
          borderRadius: '0',
        },
        content: {
          padding: '0.625rem 1rem',
        },
        summary: {
          fontSize: '13px',
          fontWeight: '500',
        },
        detail: {
          fontSize: '12px',
        },
        colorScheme: {
          light: {
            success: {
              background: '{surface.0}',
              borderColor: '{slate.200}',
              color: '{primary.700}',
            },
            error: {
              background: '{surface.0}',
              borderColor: '{slate.200}',
              color: '{red.800}',
            },
            info: {
              background: '{surface.0}',
              borderColor: '{slate.200}',
              color: '{slate.700}',
            },
            warn: {
              background: '{surface.0}',
              borderColor: '{slate.200}',
              color: '{amber.800}',
            },
          },
        },
      },
      tooltip: {
        root: {
          background: '{slate.900}',
          color: '#ffffff',
          borderRadius: '0',
          padding: '0.375rem 0.625rem',
          shadow: '0 10px 24px -12px rgba(15, 23, 42, 0.28)',
        },
      },
      message: {
        root: {
          borderRadius: '0',
        },
        text: {
          fontSize: '12px',
        },
        content: {
          padding: '0.5rem 0.75rem',
        },
        colorScheme: {
          light: {
            info: {
              background: '{slate.50}',
              borderColor: '{slate.200}',
              color: '{slate.700}',
              shadow: 'none',
            },
            success: {
              background: '{primary.50}',
              borderColor: '{primary.200}',
              color: '{primary.700}',
              shadow: 'none',
            },
            warn: {
              background: '{amber.50}',
              borderColor: '{amber.200}',
              color: '{amber.800}',
              shadow: 'none',
            },
            error: {
              background: '{red.50}',
              borderColor: '{red.200}',
              color: '{red.900}',
              shadow: 'none',
            },
          },
        },
      },
    },
  });
}

const ClinicalTheme = buildBrandPreset();
export default ClinicalTheme;
