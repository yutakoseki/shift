variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Application name prefix"
  type        = string
  default     = "hoikuen-shift"
}

variable "vercel_team_id" {
  description = "Vercel team ID. Personal accountの場合はnullで可"
  type        = string
  default     = null
}

variable "vercel_project_name" {
  description = "Vercel project name"
  type        = string
  default     = "hoikuen-shift"
}

variable "cognito_callback_urls" {
  description = "Cognito app client callback URLs"
  type        = list(string)
  default     = ["http://localhost:3000/"]
}

variable "cognito_logout_urls" {
  description = "Cognito app client logout URLs"
  type        = list(string)
  default     = ["http://localhost:3000/login"]
}
