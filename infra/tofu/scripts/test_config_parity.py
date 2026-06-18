import unittest
import config_parity_check as p

class TestParse(unittest.TestCase):
    def test_parse_tf_auth_block(self):
        tf = '''
resource "supabase_settings" "dev" {
  project_ref = "x"
  auth = jsonencode({
    site_url            = "https://dev.example.com"
    password_min_length = 6
    disable_signup      = false
    jwt_exp             = 3600
  })
}
'''
        got = p.parse_tf_auth(tf)
        self.assertEqual(got["password_min_length"], 6)
        self.assertEqual(got["disable_signup"], False)
        self.assertEqual(got["jwt_exp"], 3600)
        self.assertEqual(got["site_url"], "https://dev.example.com")

    def test_coerce(self):
        self.assertIs(p.coerce("true"), True)
        self.assertIs(p.coerce("false"), False)
        self.assertEqual(p.coerce("6"), 6)
        self.assertEqual(p.coerce('"hi"'), "hi")

class TestCompare(unittest.TestCase):
    def _toml(self, **over):
        base = {
            "minimum_password_length": 6, "jwt_expiry": 3600,
            "enable_refresh_token_rotation": True, "refresh_token_reuse_interval": 10,
            "enable_signup": True, "enable_anonymous_sign_ins": False,
            "mfa": {"max_enrolled_factors": 10},
        }
        base.update(over)
        return base

    def _tf(self, **over):
        base = {
            "password_min_length": 6, "jwt_exp": 3600,
            "refresh_token_rotation_enabled": True,
            "security_refresh_token_reuse_interval": 10,
            "disable_signup": False, "external_anonymous_users_enabled": False,
            "mfa_max_enrolled_factors": 10,
        }
        base.update(over)
        return base

    def test_all_match_no_mismatch(self):
        self.assertEqual(p.compare(self._toml(), self._tf(), self._tf()), [])

    def test_signup_inversion_match(self):
        self.assertEqual(p.compare(self._toml(enable_signup=True),
                                   self._tf(disable_signup=False),
                                   self._tf(disable_signup=False)), [])

    def test_signup_inversion_mismatch(self):
        m = p.compare(self._toml(enable_signup=True),
                      self._tf(disable_signup=True),
                      self._tf(disable_signup=True))
        self.assertTrue(any("disable_signup" in x for x in m))

    def test_value_divergence_detected(self):
        m = p.compare(self._toml(), self._tf(password_min_length=8), self._tf())
        self.assertTrue(any("password_min_length" in x for x in m))

if __name__ == "__main__":
    unittest.main()
