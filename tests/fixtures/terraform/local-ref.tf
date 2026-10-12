locals {
  x = "{\"StartAt\":\"A\",\"States\":{\"A\":{\"Type\":\"Succeed\"}}}"
}

resource "aws_sfn_state_machine" "via_local" {
  name       = "via-local"
  role_arn   = "arn:aws:iam::123456789012:role/sfn"
  definition = local.x
}
