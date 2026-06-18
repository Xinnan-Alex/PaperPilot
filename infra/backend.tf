terraform {
  backend "s3" {
    bucket       = "paperpilot-tfstate-paperpilot-bazinga"
    key          = "paperpilot/terraform.tfstate"
    region       = "ap-southeast-5"
    encrypt      = true
    use_lockfile = true
  }
}