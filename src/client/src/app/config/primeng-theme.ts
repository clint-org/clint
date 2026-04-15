import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

const ClinicalTheme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{teal.50}',
      100: '{teal.100}',
      200: '{teal.200}',
      300: '{teal.300}',
      400: '{teal.400}',
      500: '{teal.500}',
      600: '{teal.600}',
      700: '{teal.700}',
      800: '{teal.800}',
      900: '{teal.900}',
      950: '{teal.950}',
    },
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
          focusBorderColor: '{teal.600}',
          invalidBorderColor: '{red.500}',
          color: '{slate.900}',
          placeholderColor: '{slate.400}',
          shadow: 'none',
        },
        overlay: {
          select: {
            borderColor: '{slate.200}',
            shadow: '0 10px 24px -12px rgba(15, 23, 42, 0.18)',
          },
          modal: {
            borderColor: '{slate.200}',
            shadow: '0 10px 24px -12px rgba(15, 23, 42, 0.18)',
          },
        },
        list: {
          option: {
            focusBackground: '{teal.50}',
            selectedBackground: '{teal.50}',
            selectedFocusBackground: '{teal.50}',
            selectedColor: '{teal.700}',
            selectedFocusColor: '{teal.700}',
          },
        },
      },
    },
  },
  components: {
    dialog: {
      root: {
        borderRadius: '0',
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
              background: '{teal.600}',
              hoverBackground: '{teal.700}',
              activeBackground: '{teal.800}',
              borderColor: '{teal.600}',
              hoverBorderColor: '{teal.700}',
              activeBorderColor: '{teal.800}',
              color: '#ffffff',
              hoverColor: '#ffffff',
              activeColor: '#ffffff',
              disabledBackground: '{slate.200}',
              disabledBorderColor: '{slate.200}',
              disabledColor: '{slate.400}',
            },
            secondary: {
              borderColor: '{slate.300}',
              hoverBackground: '{slate.50}',
              activeBackground: '{slate.100}',
              color: '{slate.700}',
            },
            text: {
              primary: {
                hoverBackground: '{teal.50}',
                activeBackground: '{teal.100}',
                color: '{teal.600}',
              },
            },
          },
          outlined: {
            primary: {
              hoverBackground: '{teal.50}',
              activeBackground: '{teal.100}',
              borderColor: '{teal.200}',
              color: '{teal.700}',
            },
            secondary: {
              hoverBackground: '{slate.50}',
              activeBackground: '{slate.100}',
              borderColor: '{slate.300}',
              color: '{slate.700}',
            },
          },
        },
      },
    },
    select: {
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
        activeBorderColor: '{teal.600}',
        padding: '0.625rem 0.875rem',
        fontWeight: '500',
      },
      tabpanel: {
        background: 'transparent',
        padding: '1rem 0 0',
      },
      activeBar: {
        background: '{teal.600}',
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
            background: '{teal.50}',
            borderColor: '{teal.200}',
            color: '{teal.700}',
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

export default ClinicalTheme;
