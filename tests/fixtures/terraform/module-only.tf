module "sfn" {
  source = "terraform-aws-modules/step-functions/aws"

  name = "my-machine"

  definition = {
    StartAt = "A"
    States  = { A = { Type = "Succeed" } }
  }
}
