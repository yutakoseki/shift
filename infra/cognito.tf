resource "aws_cognito_user_pool" "director_pool" {
  name = "${var.project_name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }
}

resource "aws_cognito_user_pool_client" "director_app_client" {
  name                                 = "${var.project_name}-web-client"
  user_pool_id                         = aws_cognito_user_pool.director_pool.id
  generate_secret                      = false
  prevent_user_existence_errors        = "ENABLED"
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"]
  allowed_oauth_flows_user_pool_client = false
  callback_urls                        = var.cognito_callback_urls
  logout_urls                          = var.cognito_logout_urls
}
